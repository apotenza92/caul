param(
  [int]$DurationSeconds = 6,
  [int]$FrequencyHz = 440,
  [int]$SampleRateHz = 48000
)

$ErrorActionPreference = "Stop"

$path = Join-Path $env:TEMP "susura-windows-audio-stimulus.wav"
$channels = 1
$bitsPerSample = 16
$samples = $DurationSeconds * $SampleRateHz
$dataBytes = $samples * $channels * ($bitsPerSample / 8)
$byteRate = $SampleRateHz * $channels * ($bitsPerSample / 8)
$blockAlign = $channels * ($bitsPerSample / 8)

$stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter($stream)

try {
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("RIFF"))
  $writer.Write([int](36 + $dataBytes))
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("WAVE"))
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("fmt "))
  $writer.Write([int]16)
  $writer.Write([int16]1)
  $writer.Write([int16]$channels)
  $writer.Write([int]$SampleRateHz)
  $writer.Write([int]$byteRate)
  $writer.Write([int16]$blockAlign)
  $writer.Write([int16]$bitsPerSample)
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("data"))
  $writer.Write([int]$dataBytes)

  for ($index = 0; $index -lt $samples; $index += 1) {
    $phase = 2 * [Math]::PI * $FrequencyHz * $index / $SampleRateHz
    $sample = [int16]([Math]::Sin($phase) * 12000)
    $writer.Write($sample)
  }
} finally {
  $writer.Close()
  $stream.Close()
}

$player = New-Object System.Media.SoundPlayer $path
$player.PlaySync()
