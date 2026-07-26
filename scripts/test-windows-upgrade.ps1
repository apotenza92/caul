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
    $process = Start-Process -FilePath $priorInstaller -ArgumentList @('/S', "/D=$($variant.InstallRoot)") -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "$($variant.Product) prior installation failed: $($process.ExitCode)"
    }

    $executable = Join-Path $variant.InstallRoot "$($variant.Product).exe"
    if (-not (Test-Path $executable)) {
      throw "Previous executable missing: $executable"
    }

    New-Item -ItemType Directory -Force $variant.UserData | Out-Null
    $env:CAUL_DISABLE_MODEL_AUTO_DOWNLOAD = '1'
    $env:CAUL_DISABLE_UPDATE_CHECKS = '1'
    $env:CAUL_PACKAGED_LAUNCH_SMOKE_MS = '250'
    $env:CAUL_USER_DATA_DIR = $variant.UserData
    $process = Start-Process -FilePath $executable -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "$($variant.Product) prior launch failed: $($process.ExitCode)"
    }

    Set-Content `
      -Path (Join-Path $variant.UserData 'upgrade-preservation-marker.txt') `
      -Value "$($variant.Channel)-$PriorTag"
  }

  foreach ($variant in $variants) {
    $candidateInstaller = Join-Path $repositoryRoot "candidate/$($variant.Prefix)-windows-$Architecture-setup.exe"
    $process = Start-Process -FilePath $candidateInstaller -ArgumentList @('/S', "/D=$($variant.InstallRoot)") -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "$($variant.Product) candidate installation failed: $($process.ExitCode)"
    }

    $executable = Join-Path $variant.InstallRoot "$($variant.Product).exe"
    $env:CAUL_USER_DATA_DIR = $variant.UserData
    $process = Start-Process -FilePath $executable -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "$($variant.Product) upgraded launch failed: $($process.ExitCode)"
    }

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
      Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait | Out-Null
    }
  }
}
