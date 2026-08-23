# Sample-accurate WAV analysis for the timeline-audio-remux spike.
#
# silencedetect is threshold-shaped and drifts by ~20 ms on decaying bursts,
# which is too coarse to judge Q-7 (pitch), Q-10 (placement) and Q-11 (mix
# equivalence). This reads the decoded samples directly instead.
#
# Usage:
#   pwsh -File analyze-wav.ps1 -Path ref.wav -Ffmpeg <ffmpeg.exe> -Mode onsets [-Threshold 0.02]
#   pwsh -File analyze-wav.ps1 -Path ref.wav -Ffmpeg <ffmpeg.exe> -Mode segments -Segments "0,1,click;5,6,speed"
#   pwsh -File analyze-wav.ps1 -Path a.wav  -Ffmpeg <ffmpeg.exe> -Mode compare -Reference b.wav

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Ffmpeg,
    [ValidateSet('onsets', 'segments', 'compare')][string]$Mode = 'onsets',
    [double]$Threshold = 0.02,
    [double]$MinGapSec = 0.05,
    [string]$Segments = '',
    [string]$Reference = '',
    [int]$Rate = 48000
)

$ErrorActionPreference = 'Stop'

# Decode the LEFT channel to float32 so analysis is independent of the source
# format. Note: "-ac 1" must NOT be used here - ffmpeg's stereo->mono matrix is
# normalized and multiplies an identical L/R pair by sqrt(2) (+3.01 dB), which
# silently inflates every peak measurement. "pan=mono|c0=c0" takes channel 0
# verbatim.
function Read-Mono {
    param([string]$File)
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        & $Ffmpeg -hide_banner -loglevel error -y -i $File -af "pan=mono|c0=c0" -f f32le -ar $Rate $tmp | Out-Null
        $bytes = [System.IO.File]::ReadAllBytes($tmp)
        $n = [int]($bytes.Length / 4)
        $buf = New-Object 'System.Single[]' $n
        [System.Buffer]::BlockCopy($bytes, 0, $buf, 0, $n * 4)
        return , $buf
    }
    finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

# Fundamental frequency via zero-crossing rate. Adequate here because every
# fixture source is a pure tone or a click train.
function Get-DominantHz {
    param([Single[]]$Samples, [int]$From, [int]$To)
    $cross = 0; $prev = 0.0
    for ($i = $From; $i -lt $To; $i++) {
        $v = $Samples[$i]
        if ($prev -le 0 -and $v -gt 0) { $cross++ }
        $prev = $v
    }
    $sec = ($To - $From) / [double]$Rate
    if ($sec -le 0) { return 0 }
    return [math]::Round($cross / $sec, 1)
}

function Get-Stats {
    param([Single[]]$Samples, [int]$From, [int]$To)
    $peak = 0.0; $sum = 0.0
    for ($i = $From; $i -lt $To; $i++) {
        $a = [math]::Abs($Samples[$i])
        if ($a -gt $peak) { $peak = $a }
        $sum += [double]$Samples[$i] * $Samples[$i]
    }
    $n = [math]::Max(1, $To - $From)
    return [pscustomobject]@{
        Peak = [math]::Round($peak, 6)
        Rms  = [math]::Round([math]::Sqrt($sum / $n), 6)
    }
}

$samples = Read-Mono -File $Path
Write-Host ("file      : {0}" -f (Split-Path $Path -Leaf))
Write-Host ("samples   : {0} ({1:N6} s @ {2} Hz mono)" -f $samples.Length, ($samples.Length / [double]$Rate), $Rate)

switch ($Mode) {
    'onsets' {
        $minGap = [int]($MinGapSec * $Rate)
        $lastAbove = -$minGap * 2
        $onsets = New-Object System.Collections.Generic.List[double]
        for ($i = 0; $i -lt $samples.Length; $i++) {
            if ([math]::Abs($samples[$i]) -lt $Threshold) { continue }
            if (($i - $lastAbove) -ge $minGap) { $onsets.Add([math]::Round($i / [double]$Rate, 6)) }
            $lastAbove = $i
        }
        Write-Host ("threshold : {0} (min gap {1} s)" -f $Threshold, $MinGapSec)
        Write-Host "onsets    :"
        foreach ($o in $onsets) { Write-Host ("  {0,12:F6}" -f $o) }
    }
    'segments' {
        # RMS is the robust comparison metric: peak-of-sum depends on the relative
        # phase of the summed tones, which Unity and ffmpeg do not reproduce
        # identically (see README Q-11).
        Write-Host ("{0,-28} {1,10} {2,10} {3,12} {4,12} {5,10}" -f "segment", "start", "end", "peak", "rms", "domHz")
        foreach ($spec in ($Segments -split ';')) {
            if (-not $spec.Trim()) { continue }
            $p = $spec -split ','
            $s = [double]$p[0]; $e = [double]$p[1]; $label = $p[2]
            $from = [int]($s * $Rate); $to = [math]::Min([int]($e * $Rate), $samples.Length)
            if ($from -ge $to) { Write-Host ("{0,-28} out of range" -f $label); continue }
            $st = Get-Stats -Samples $samples -From $from -To $to
            $hz = Get-DominantHz -Samples $samples -From $from -To $to
            Write-Host ("{0,-28} {1,10:F4} {2,10:F4} {3,12:F6} {4,12:F6} {5,10}" -f $label, $s, $e, $st.Peak, $st.Rms, $hz)
        }
    }
    'compare' {
        if (-not $Reference) { throw "-Reference is required for -Mode compare" }
        $other = Read-Mono -File $Reference
        $n = [math]::Min($samples.Length, $other.Length)
        $maxDiff = 0.0; $sumSq = 0.0; $argMax = 0
        for ($i = 0; $i -lt $n; $i++) {
            $d = [math]::Abs($samples[$i] - $other[$i])
            if ($d -gt $maxDiff) { $maxDiff = $d; $argMax = $i }
            $sumSq += [double]$d * $d
        }
        $rmsDiff = [math]::Sqrt($sumSq / [math]::Max(1, $n))
        Write-Host ("reference : {0}" -f (Split-Path $Reference -Leaf))
        Write-Host ("overlap   : {0} samples ({1:F6} s); length delta {2} samples" -f $n, ($n / [double]$Rate), ($samples.Length - $other.Length))
        Write-Host ("max |diff|: {0:F6} at {1:F6} s" -f $maxDiff, ($argMax / [double]$Rate))
        Write-Host ("rms  diff : {0:F6}" -f $rmsDiff)
        if ($rmsDiff -gt 0) {
            Write-Host ("rms  diff : {0:F2} dBFS" -f (20 * [math]::Log10($rmsDiff)))
        }
    }
}
