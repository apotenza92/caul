[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('stable', 'beta')]
  [string]$ReleaseChannel,

  [Parameter(Mandatory)]
  [ValidateSet('x64', 'arm64')]
  [string]$Arch,

  [Parameter(Mandatory)]
  [string]$ReleaseDirectory
)

$ErrorActionPreference = 'Stop'
$variants = @(
  @{ Channel = 'beta'; Prefix = 'Caul-Beta'; Product = 'Caul Beta' }
)
if ($ReleaseChannel -eq 'stable') {
  $variants = @(
    @{ Channel = 'stable'; Prefix = 'Caul'; Product = 'Caul' }
  ) + $variants
}

try {
  foreach ($variant in $variants) {
    $variant.InstallRoot = Join-Path $env:RUNNER_TEMP "public-$($variant.Channel)-install"
    $installer = Join-Path $ReleaseDirectory "$($variant.Prefix)-windows-$Arch-setup.exe"
    $installStartedAt = Get-Date
    $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$($variant.InstallRoot)") -Wait -PassThru
    if ($process.ExitCode -ne 0) {
      throw "$($variant.Product) public installation failed: $($process.ExitCode)"
    }

    $expectedExecutable = Join-Path $variant.InstallRoot "$($variant.Product).exe"
    if (-not (Test-Path $expectedExecutable)) {
      & ./scripts/write-windows-defender-evidence.ps1 `
        -Since $installStartedAt `
        -InstallRoot $variant.InstallRoot
      throw "$($variant.Product) public installation is missing $expectedExecutable."
    }

    & node scripts/verify-native-package.mjs `
      --platform windows `
      --arch $Arch `
      --channel $variant.Channel `
      --release-dir $ReleaseDirectory `
      --unpacked-dir $variant.InstallRoot
    if ($LASTEXITCODE -ne 0) {
      throw "$($variant.Product) public package verification failed: $LASTEXITCODE"
    }
  }

  if ($ReleaseChannel -eq 'stable') {
    $stableExecutable = Join-Path $variants[0].InstallRoot 'Caul.exe'
    $betaExecutable = Join-Path $variants[1].InstallRoot 'Caul Beta.exe'
    if (-not (Test-Path $stableExecutable) -or -not (Test-Path $betaExecutable)) {
      throw 'Stable and beta public Windows applications did not coexist.'
    }
  }
}
finally {
  foreach ($variant in $variants) {
    if (-not $variant.ContainsKey('InstallRoot')) {
      continue
    }
    $uninstaller = Get-ChildItem $variant.InstallRoot -File -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($uninstaller) {
      Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait | Out-Null
    }
  }
}
