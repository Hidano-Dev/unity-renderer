# Builds the ffmpeg-side mix of the AudioSpikeRoot fixture, so it can be
# compared against Unity's own captured mix (spike question Q-11), and so the
# time-normalization result (Q-10) can be checked end to end.
#
# The clip table below is the MixPlan the extractor is expected to produce for
# Assets/Timeline/AudioSpikeRoot.playable: muted tracks removed, the broken
# ControlClip subtree removed, nested clips folded to root-absolute time with an
# accumulated effective speed, and clip volume x track volume folded into gain.
#
# Usage:
#   pwsh -File build-ffmpeg-mix.ps1 -Ffmpeg <ffmpeg.exe> -Out <mix.wav> [-PitchMode resample|preserve-pitch]

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Ffmpeg,
    [Parameter(Mandatory = $true)][string]$Out,
    [ValidateSet('resample', 'preserve-pitch')][string]$PitchMode = 'resample',
    [string]$AudioDir = '',
    [int]$Rate = 48000,
    [int]$TotalSamples = 1007616   # matches Unity's 630-frame @30fps capture
)

$ErrorActionPreference = 'Stop'
if (-not $AudioDir) {
    $AudioDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')) 'spike\unity-project\Assets\Audio'
}

# rootStartSec / rootDurationSec are in ROOT time; clipInSec and the source
# window are in SOURCE time. sourceWindow = rootDuration * effectiveSpeed.
$plan = @(
    [pscustomobject]@{ Label = 'A_Simple';    File = 'click_48k_st_1s.wav';     RootStart = 0.0;  RootDuration = 1.0; ClipIn = 0.0;   Speed = 1.0; Loop = $false; Gain = 1.0;  SrcRate = 48000 }
    [pscustomobject]@{ Label = 'A_InGroup';   File = 'tone440_44k_st_2s.wav';   RootStart = 1.0;  RootDuration = 2.0; ClipIn = 0.0;   Speed = 1.0; Loop = $false; Gain = 0.40; SrcRate = 44100 }
    [pscustomobject]@{ Label = 'A_Overlap';   File = 'tone880_48k_mono_3s.wav'; RootStart = 1.5;  RootDuration = 3.0; ClipIn = 0.0;   Speed = 1.0; Loop = $false; Gain = 0.25; SrcRate = 48000 }
    [pscustomobject]@{ Label = 'A_Speed';     File = 'tone440_44k_st_2s.wav';   RootStart = 5.0;  RootDuration = 1.0; ClipIn = 0.25;  Speed = 2.0; Loop = $false; Gain = 1.0;  SrcRate = 44100 }
    [pscustomobject]@{ Label = 'A_Loop';      File = 'beep1k_48k_st_0p5s.wav';  RootStart = 8.0;  RootDuration = 2.5; ClipIn = 0.0;   Speed = 1.0; Loop = $true;  Gain = 1.0;  SrcRate = 48000 }
    [pscustomobject]@{ Label = 'L1_Audio';    File = 'click_48k_st_1s.wav';     RootStart = 11.0; RootDuration = 2.0; ClipIn = 0.0;   Speed = 0.5; Loop = $false; Gain = 1.0;  SrcRate = 48000 }
    [pscustomobject]@{ Label = 'L2_Audio';    File = 'tone440_44k_st_2s.wav';   RootStart = 13.0; RootDuration = 1.0; ClipIn = 0.5;   Speed = 1.0; Loop = $false; Gain = 1.0;  SrcRate = 44100 }
    [pscustomobject]@{ Label = 'A_Composite'; File = 'beep1k_48k_st_0p5s.wav';  RootStart = 18.0; RootDuration = 3.0; ClipIn = 0.125; Speed = 1.5; Loop = $true;  Gain = 0.75; SrcRate = 48000 }
)

$inputs = New-Object System.Collections.Generic.List[string]
$chains = New-Object System.Collections.Generic.List[string]
$labels = New-Object System.Collections.Generic.List[string]

for ($i = 0; $i -lt $plan.Count; $i++) {
    $c = $plan[$i]
    $file = Join-Path $AudioDir $c.File
    if (-not (Test-Path $file)) { throw "missing source: $file" }
    # A looping clip needs the decoder to keep producing input; the filter graph
    # then cuts it to the exact window.
    if ($c.Loop) { $inputs.Add('-stream_loop'); $inputs.Add('-1') }
    $inputs.Add('-i'); $inputs.Add($file)

    $srcWindow = $c.RootDuration * $c.Speed
    $trimStart = $c.ClipIn
    $trimEnd = $c.ClipIn + $srcWindow
    $delaySamples = [int][math]::Round($c.RootStart * $Rate)

    $steps = New-Object System.Collections.Generic.List[string]
    # 1) trim in SOURCE time, then restamp so downstream filters see t=0
    $steps.Add(("atrim=start={0}:end={1}" -f $trimStart.ToString('R', [cultureinfo]::InvariantCulture), $trimEnd.ToString('R', [cultureinfo]::InvariantCulture)))
    $steps.Add('asetpts=N/SR/TB')
    # 2) speed
    if ($c.Speed -ne 1.0) {
        if ($PitchMode -eq 'resample') {
            # asetrate is sample-exact; it reinterprets the rate, so it must be
            # scaled from the SOURCE rate, not from the output rate.
            $steps.Add(("asetrate={0}" -f [int][math]::Round($c.SrcRate * $c.Speed)))
        }
        else {
            $steps.Add(("atempo={0}" -f $c.Speed.ToString('R', [cultureinfo]::InvariantCulture)))
        }
    }
    # 3) normalize to the mixing format. Unity applies the same normalized
    #    mono->stereo matrix (-3.01 dB), so aformat is the matching conversion;
    #    pan=stereo|c0=c0|c1=c0 would be 3 dB too loud.
    $steps.Add(("aformat=sample_fmts=fltp:sample_rates={0}:channel_layouts=stereo" -f $Rate))
    # 4) gain = clip volume x track volume
    if ($c.Gain -ne 1.0) { $steps.Add(("volume={0}" -f $c.Gain.ToString('R', [cultureinfo]::InvariantCulture))) }
    # 5) placement, quantized to whole samples
    if ($delaySamples -gt 0) { $steps.Add(("adelay={0}S:all=1" -f $delaySamples)) }

    $lbl = "c$i"
    $chains.Add(("[{0}:a]{1}[{2}]" -f $i, ($steps -join ','), $lbl))
    $labels.Add("[$lbl]")
    Write-Host ("{0,-14} src[{1,7:F3}..{2,7:F3}] -> root {3,7:F3} ({4} samples) speed {5} gain {6}" -f `
        $c.Label, $trimStart, $trimEnd, $c.RootStart, $delaySamples, $c.Speed, $c.Gain)
}

# normalize=0 keeps amix a pure summation, which is what Unity does.
$chains.Add(("{0}amix=inputs={1}:normalize=0:duration=longest[mixed]" -f ($labels -join ''), $plan.Count))
# apad then a sample-exact atrim forces the output to the video's exact length.
$chains.Add(("[mixed]apad,atrim=end_sample={0},asetpts=N/SR/TB[out]" -f $TotalSamples))

$script = ($chains -join ';')
$scriptPath = [System.IO.Path]::ChangeExtension($Out, '.filter.txt')
# The graph is passed as a script file: a graph with this many clips easily
# exceeds the Windows command-line length limit.
Set-Content -Path $scriptPath -Value $script -Encoding ascii -NoNewline

$args = @('-hide_banner', '-loglevel', 'error', '-y') + $inputs + @('-filter_complex_script', $scriptPath, '-map', '[out]', '-c:a', 'pcm_f32le', $Out)
& $Ffmpeg @args
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host ("filter script : {0} ({1} bytes)" -f $scriptPath, (Get-Item $scriptPath).Length)
Write-Host ("output        : {0} ({1} bytes)" -f $Out, (Get-Item $Out).Length)
