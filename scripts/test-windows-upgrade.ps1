[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('x64', 'arm64')]
  [string]$Architecture,

  [Parameter(Mandatory)]
  [ValidateSet('stable', 'beta')]
  [string]$Channel,

  [Parameter(Mandatory)]
  [ValidatePattern('^v\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$')]
  [string]$PriorTag,

  [Parameter(Mandatory)]
  [ValidatePattern('^v\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$')]
  [string]$CandidateTag
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$launchVerifier = Join-Path $repositoryRoot 'scripts/verify-windows-packaged-launch.mjs'

function Invoke-BoundedProcess {
  param(
    [Parameter(Mandatory)]
    [string]$FilePath,

    [Parameter(Mandatory)]
    [string]$Arguments,

    [Parameter(Mandatory)]
    [int]$TimeoutSeconds,

    [Parameter(Mandatory)]
    [string]$FailureLabel
  )

  $startedAt = Get-Date
  Write-Host "Starting bounded process for ${FailureLabel}: $FilePath"
  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  while (-not $process.HasExited) {
    $elapsedSeconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
    $remainingMilliseconds = [math]::Max(
      0,
      [math]::Min(30000, ($TimeoutSeconds * 1000) - [int]($elapsedSeconds * 1000))
    )
    if ($remainingMilliseconds -eq 0 -or -not $process.WaitForExit($remainingMilliseconds)) {
      $elapsedSeconds = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
      if ($elapsedSeconds -ge $TimeoutSeconds) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$FailureLabel timed out after $TimeoutSeconds seconds"
      }
      Write-Host "$FailureLabel remains active after $elapsedSeconds seconds"
    }
  }
  if ($process.ExitCode -ne 0) {
    throw "${FailureLabel}: $($process.ExitCode)"
  }
  $elapsed = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  Write-Host "Completed bounded process for $FailureLabel in $elapsed seconds"
}

function Invoke-PackagedLaunch {
  param(
    [Parameter(Mandatory)]
    [string]$Executable,

    [Parameter(Mandatory)]
    [string]$UserData,

    [Parameter(Mandatory)]
    [string]$InstallRoot,

    [Parameter(Mandatory)]
    [string]$FailureLabel
  )

  $launchExitCode = 1
  try {
    node $launchVerifier `
      --executable $Executable `
      --user-data $UserData
    $launchExitCode = $LASTEXITCODE
  }
  finally {
    $installPrefix = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ExecutablePath `
          -and $_.ExecutablePath.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
      } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  }

  if ($launchExitCode -ne 0) {
    throw "${FailureLabel}: $launchExitCode"
  }
}

$variants = @(
  @{
    Channel = 'beta'
    Prefix = 'Caul-Beta'
    Product = 'Caul Beta'
  }
)

if ($Channel -eq 'stable') {
  $variants = @(
    @{
      Channel = 'stable'
      Prefix = 'Caul'
      Product = 'Caul'
    }
  ) + $variants
}

$legacyArm64BootstrapEnabled = (
  $Architecture -eq 'arm64' `
    -and $PriorTag -eq 'v0.1.21' `
    -and $env:WINDOWS_ARM64_LEGACY_PUBLIC_BOOTSTRAP_TAG -eq $CandidateTag
)

try {
  foreach ($variant in $variants) {
    # Electron Builder's NSIS updater atomically moves the previous installation
    # through its plug-in directory under %TEMP%. Keep the isolated installation
    # on that same volume so the gate exercises the normal updater path.
    $variant.InstallRoot = Join-Path $env:TEMP "caul-$($variant.Channel)-install"
    $variant.UserData = Join-Path $env:TEMP "caul-$($variant.Channel)-user-data"
    $priorInstaller = Join-Path $repositoryRoot "prior/$($variant.Prefix)-windows-$Architecture-setup.exe"
    Invoke-BoundedProcess `
      -FilePath $priorInstaller `
      -Arguments "/S /D=$($variant.InstallRoot)" `
      -TimeoutSeconds 300 `
      -FailureLabel "$($variant.Product) prior installation failed"

    $executable = Join-Path $variant.InstallRoot "$($variant.Product).exe"
    if (-not (Test-Path $executable)) {
      if (-not $legacyArm64BootstrapEnabled) {
        throw "Previous executable missing: $executable"
      }
      $legacyUninstaller = Get-ChildItem `
        $variant.InstallRoot `
        -File `
        -Filter 'Uninstall*.exe' `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if (-not $legacyUninstaller) {
        throw "The exact legacy ARM64 partial-install signature was not found in $($variant.InstallRoot)."
      }
      Write-Warning (
        "Authenticated $PriorTag ARM64 installer reproduced its known partial-install state for " `
          + "$($variant.Product). Candidate recovery and user-data preservation will now be verified."
      )
      $variant.LegacyPartialInstall = $true
    }

    New-Item -ItemType Directory -Force $variant.UserData | Out-Null
    if (-not $variant.ContainsKey('LegacyPartialInstall')) {
      Invoke-PackagedLaunch `
        -Executable $executable `
        -UserData $variant.UserData `
        -InstallRoot $variant.InstallRoot `
        -FailureLabel "$($variant.Product) prior launch failed"
    }

    Set-Content `
      -Path (Join-Path $variant.UserData 'upgrade-preservation-marker.txt') `
      -Value "$($variant.Channel)-$PriorTag"
  }

  foreach ($variant in $variants) {
    $candidateInstaller = Join-Path $repositoryRoot "candidate/$($variant.Prefix)-windows-$Architecture-setup.exe"
    Invoke-BoundedProcess `
      -FilePath $candidateInstaller `
      -Arguments "/S /D=$($variant.InstallRoot)" `
      -TimeoutSeconds 900 `
      -FailureLabel "$($variant.Product) candidate installation failed"

    $executable = Join-Path $variant.InstallRoot "$($variant.Product).exe"
    Invoke-PackagedLaunch `
      -Executable $executable `
      -UserData $variant.UserData `
      -InstallRoot $variant.InstallRoot `
      -FailureLabel "$($variant.Product) upgraded launch failed"

    node (Join-Path $repositoryRoot 'scripts/verify-native-package.mjs') `
      --platform windows `
      --arch $Architecture `
      --channel $variant.Channel `
      --release-dir (Join-Path $repositoryRoot 'candidate') `
      --unpacked-dir $variant.InstallRoot
    if ($LASTEXITCODE -ne 0) {
      throw "$($variant.Product) upgraded package verification failed: $LASTEXITCODE"
    }

    $marker = Join-Path $variant.UserData 'upgrade-preservation-marker.txt'
    if ((Get-Content $marker -Raw).Trim() -ne "$($variant.Channel)-$PriorTag") {
      throw "$($variant.Product) did not preserve existing user data."
    }
  }

  if ($Channel -eq 'stable') {
    $stableExists = Test-Path (Join-Path $variants[0].InstallRoot 'Caul.exe')
    $betaExists = Test-Path (Join-Path $variants[1].InstallRoot 'Caul Beta.exe')
    if (-not $stableExists -or -not $betaExists) {
      throw 'Stable and beta Windows applications did not coexist after upgrade.'
    }
  }

  if ($legacyArm64BootstrapEnabled) {
    $recoveredVariants = @($variants | Where-Object { $_.ContainsKey('LegacyPartialInstall') })
    if ($recoveredVariants.Count -ne $variants.Count) {
      throw 'The one-time Windows ARM64 legacy recovery did not reproduce every expected partial installation.'
    }
    Write-Host (
      "Verified exact-tag Windows ARM64 recovery from authenticated $PriorTag partial installations " `
        + "to $CandidateTag while preserving stable and beta user data."
    )
  }
}
finally {
  foreach ($variant in $variants) {
    if (-not $variant.ContainsKey('InstallRoot')) {
      continue
    }

    $uninstaller = Get-ChildItem `
      $variant.InstallRoot `
      -File `
      -Filter 'Uninstall*.exe' `
      -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($uninstaller) {
      Invoke-BoundedProcess `
        -FilePath $uninstaller.FullName `
        -Arguments '/S' `
        -TimeoutSeconds 180 `
        -FailureLabel "$($variant.Product) uninstall failed"
    }
  }
}
