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
  [string]$PriorTag
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

  $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "$FailureLabel timed out after $TimeoutSeconds seconds"
  }
  if ($process.ExitCode -ne 0) {
    throw "${FailureLabel}: $($process.ExitCode)"
  }
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

try {
  foreach ($variant in $variants) {
    $variant.InstallRoot = Join-Path $env:RUNNER_TEMP "caul-$($variant.Channel)-install"
    $variant.UserData = Join-Path $env:RUNNER_TEMP "caul-$($variant.Channel)-user-data"
    $priorInstaller = Join-Path $repositoryRoot "prior/$($variant.Prefix)-windows-$Architecture-setup.exe"
    Invoke-BoundedProcess `
      -FilePath $priorInstaller `
      -Arguments "/S /D=$($variant.InstallRoot)" `
      -TimeoutSeconds 120 `
      -FailureLabel "$($variant.Product) prior installation failed"

    $executable = Join-Path $variant.InstallRoot "$($variant.Product).exe"
    if (-not (Test-Path $executable)) {
      throw "Previous executable missing: $executable"
    }

    New-Item -ItemType Directory -Force $variant.UserData | Out-Null
    Invoke-PackagedLaunch `
      -Executable $executable `
      -UserData $variant.UserData `
      -InstallRoot $variant.InstallRoot `
      -FailureLabel "$($variant.Product) prior launch failed"

    Set-Content `
      -Path (Join-Path $variant.UserData 'upgrade-preservation-marker.txt') `
      -Value "$($variant.Channel)-$PriorTag"
  }

  foreach ($variant in $variants) {
    $candidateInstaller = Join-Path $repositoryRoot "candidate/$($variant.Prefix)-windows-$Architecture-setup.exe"
    Invoke-BoundedProcess `
      -FilePath $candidateInstaller `
      -Arguments "/S /D=$($variant.InstallRoot)" `
      -TimeoutSeconds 120 `
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
        -TimeoutSeconds 90 `
        -FailureLabel "$($variant.Product) uninstall failed"
    }
  }
}
