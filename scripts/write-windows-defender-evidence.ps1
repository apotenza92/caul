[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [datetime]$Since,

  [Parameter(Mandatory)]
  [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$cutoff = $Since.AddMinutes(-1)

Write-Host '::group::Microsoft Defender installation evidence'
try {
  $threatNames = @{}
  try {
    Get-MpThreat | ForEach-Object {
      $threatNames[[string]$_.ThreatID] = $_.ThreatName
    }
  }
  catch {
    Write-Warning "Could not resolve Defender threat names: $($_.Exception.Message)"
  }

  try {
    $detections = @(
      Get-MpThreatDetection | Where-Object {
        $resourceText = @($_.Resources) -join ';'
        ($_.InitialDetectionTime -and $_.InitialDetectionTime -ge $cutoff) `
          -or ($_.LastThreatStatusChangeTime -and $_.LastThreatStatusChangeTime -ge $cutoff) `
          -or $resourceText.Contains($InstallRoot, [StringComparison]::OrdinalIgnoreCase)
      } | Sort-Object InitialDetectionTime
    )
    if ($detections.Count -eq 0) {
      Write-Host "No Microsoft Defender detections matched the installation window or root $InstallRoot."
    }
    else {
      $detections | Select-Object `
        ThreatID, `
        @{ Name = 'ThreatName'; Expression = { $threatNames[[string]$_.ThreatID] } }, `
        ActionSuccess, `
        CurrentThreatExecutionStatusID, `
        DetectionTime, `
        InitialDetectionTime, `
        LastThreatStatusChangeTime, `
        Resources |
        ConvertTo-Json -Depth 4 |
        Write-Host
    }
  }
  catch {
    Write-Warning "Could not read Microsoft Defender detections: $($_.Exception.Message)"
  }

  try {
    $events = @(
      Get-WinEvent -FilterHashtable @{
        LogName = 'Microsoft-Windows-Windows Defender/Operational'
        StartTime = $cutoff
      } | Where-Object { $_.Id -in 1116, 1117 }
    )
    if ($events.Count -eq 0) {
      Write-Host 'No Microsoft Defender detection or remediation events occurred in the installation window.'
    }
    else {
      $events | Select-Object TimeCreated, Id, Message |
        ConvertTo-Json -Depth 3 |
        Write-Host
    }
  }
  catch {
    Write-Warning "Could not read the Microsoft Defender operational log: $($_.Exception.Message)"
  }
}
finally {
  Write-Host '::endgroup::'
}
