# Generates the deterministic WAV fixtures used by the timeline-audio-remux spike.
# Output: spike/unity-project/Assets/Audio/*.wav  (16-bit PCM, little endian)
#
# The fixtures are intentionally varied so the spike can measure resampling
# (44.1 kHz source), channel normalization (mono source) and loop folding
# (source shorter than the clip duration).
#
# Usage:  pwsh -File spike/timeline-audio/tools/gen-audio.ps1

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$outDir = Join-Path $repoRoot 'spike\unity-project\Assets\Audio'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

function Write-Wav {
    param(
        [string]$Path,
        [int]$SampleRate,
        [int]$Channels,
        [int16[]]$Samples   # interleaved
    )
    $stream = [System.IO.File]::Create($Path)
    try {
        $w = New-Object System.IO.BinaryWriter($stream)
        $bitsPerSample = 16
        $blockAlign = $Channels * $bitsPerSample / 8
        $byteRate = $SampleRate * $blockAlign
        $dataSize = $Samples.Length * 2

        $w.Write([char[]]'RIFF')
        $w.Write([uint32](36 + $dataSize))
        $w.Write([char[]]'WAVE')
        $w.Write([char[]]'fmt ')
        $w.Write([uint32]16)
        $w.Write([uint16]1)            # PCM
        $w.Write([uint16]$Channels)
        $w.Write([uint32]$SampleRate)
        $w.Write([uint32]$byteRate)
        $w.Write([uint16]$blockAlign)
        $w.Write([uint16]$bitsPerSample)
        $w.Write([char[]]'data')
        $w.Write([uint32]$dataSize)
        foreach ($s in $Samples) { $w.Write([int16]$s) }
        $w.Flush()
    }
    finally { $stream.Dispose() }
    $seconds = [math]::Round($Samples.Length / $Channels / $SampleRate, 4)
    Write-Host ("  {0}  {1} Hz  {2}ch  {3}s" -f (Split-Path $Path -Leaf), $SampleRate, $Channels, $seconds)
}

function New-Tone {
    param([int]$SampleRate, [int]$Channels, [double]$Seconds, [double]$Freq, [double]$Amp = 0.5)
    $frames = [int]($SampleRate * $Seconds)
    $buf = New-Object 'System.Int16[]' ($frames * $Channels)
    $twoPiF = 2.0 * [math]::PI * $Freq / $SampleRate
    for ($i = 0; $i -lt $frames; $i++) {
        $v = [int16][int]([math]::Sin($twoPiF * $i) * $Amp * 32767)
        for ($c = 0; $c -lt $Channels; $c++) { $buf[$i * $Channels + $c] = $v }
    }
    return , $buf
}

# Click track: 5 ms full-scale bursts at known offsets, silence elsewhere.
# Used to measure placement error in the muxed output (task 6.1).
function New-ClickTrack {
    param([int]$SampleRate, [int]$Channels, [double]$Seconds, [double[]]$ClickOffsetsSec)
    $frames = [int]($SampleRate * $Seconds)
    $buf = New-Object 'System.Int16[]' ($frames * $Channels)
    $burst = [int]($SampleRate * 0.005)
    foreach ($off in $ClickOffsetsSec) {
        $start = [int]($SampleRate * $off)
        for ($i = 0; $i -lt $burst; $i++) {
            $idx = $start + $i
            if ($idx -ge $frames) { break }
            # decaying square burst -> sharp, easy to locate in a waveform
            if (($i % 8) -lt 4) { $sign = 1 } else { $sign = -1 }
            $env = 1.0 - ($i / [double]$burst)
            $v = [int16][int]($sign * $env * 0.9 * 32767)
            for ($c = 0; $c -lt $Channels; $c++) { $buf[$idx * $Channels + $c] = $v }
        }
    }
    return , $buf
}

Write-Host "Writing WAV fixtures to $outDir"

Write-Wav -Path (Join-Path $outDir 'click_48k_st_1s.wav') -SampleRate 48000 -Channels 2 `
    -Samples (New-ClickTrack -SampleRate 48000 -Channels 2 -Seconds 1.0 -ClickOffsetsSec @(0.0, 0.25, 0.5, 0.75))

Write-Wav -Path (Join-Path $outDir 'tone440_44k_st_2s.wav') -SampleRate 44100 -Channels 2 `
    -Samples (New-Tone -SampleRate 44100 -Channels 2 -Seconds 2.0 -Freq 440 -Amp 0.5)

Write-Wav -Path (Join-Path $outDir 'tone880_48k_mono_3s.wav') -SampleRate 48000 -Channels 1 `
    -Samples (New-Tone -SampleRate 48000 -Channels 1 -Seconds 3.0 -Freq 880 -Amp 0.5)

Write-Wav -Path (Join-Path $outDir 'beep1k_48k_st_0p5s.wav') -SampleRate 48000 -Channels 2 `
    -Samples (New-Tone -SampleRate 48000 -Channels 2 -Seconds 0.5 -Freq 1000 -Amp 0.6)

Write-Host "Done."
