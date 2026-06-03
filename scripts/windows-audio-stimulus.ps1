param(
  [int]$DurationSeconds = 6,
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
$chords = @(
  '261.63,329.63,392.00',
  '293.66,369.99,440.00',
  '246.94,329.63,392.00',
  '220.00,277.18,329.63'
)
$stepSamples = [Math]::Max(1, [int]($SampleRateHz * 0.5))

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
    $chord = $chords[[int](($index / $stepSamples) % $chords.Count)].Split([char]44) | ForEach-Object { [double]$_ }
    $positionInStep = ($index % $stepSamples) / $stepSamples
    $attack = [Math]::Min(1.0, $positionInStep / 0.08)
    $release = [Math]::Min(1.0, (1.0 - $positionInStep) / 0.18)
    $envelope = [Math]::Max(0.0, [Math]::Min($attack, $release))
    $mixed = 0.0

    for ($noteIndex = 0; $noteIndex -lt $chord.Count; $noteIndex += 1) {
      $frequency = $chord[$noteIndex]
      $phase = 2 * [Math]::PI * $frequency * $index / $SampleRateHz
      $mixed += [Math]::Sin($phase) * (1.0 - ($noteIndex * 0.15))
    }

    $sample = [int16]($mixed / $chord.Count * $envelope * 9000)
    $writer.Write($sample)
  }
} finally {
  $writer.Close()
  $stream.Close()
}

$player = New-Object System.Media.SoundPlayer $path
$player.PlaySync()
