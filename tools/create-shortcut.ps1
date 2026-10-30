[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.Drawing
[xml]$svg=Get-Content -LiteralPath (Join-Path $projectRoot 'embedded/assets/chatgpt-knot.svg') -Raw
$pathText=$svg.DocumentElement.SelectSingleNode("*[local-name()='path']").GetAttribute('d')
$tokens=[regex]::Matches($pathText,'[MLZ]|-?\d+(?:\.\d+)?')
$outline=New-Object System.Drawing.Drawing2D.GraphicsPath
$outline.FillMode=[System.Drawing.Drawing2D.FillMode]::Alternate
try {
  $i=0;$previous=[Drawing.PointF]::new(0,0)
  while($i -lt $tokens.Count) {
    $command=$tokens[$i].Value;$i++
    if($command -eq 'Z'){$outline.CloseFigure();continue}
    if($command -notin @('M','L')){throw 'Expected explicit M/L/Z logo geometry.'}
    $x=[single]::Parse($tokens[$i].Value,[Globalization.CultureInfo]::InvariantCulture);$i++
    $y=[single]::Parse($tokens[$i].Value,[Globalization.CultureInfo]::InvariantCulture);$i++
    $point=[Drawing.PointF]::new($x,$y)
    if($command -eq 'M'){$outline.StartFigure()}else{$outline.AddLine($previous,$point)}
    $previous=$point
  }
  $images=@()
  foreach($size in @(16,24,32,48,64,128,256)) {
    $bitmap=[Drawing.Bitmap]::new($size,$size)
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    $memory=[IO.MemoryStream]::new()
    try {
      $graphics.Clear([Drawing.Color]::FromArgb(255,8,8,8))
      $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $scale=[single]($size*0.84/486)
      $graphics.TranslateTransform([single]($size*0.08),[single]($size*0.08))
      $graphics.ScaleTransform($scale,$scale)
      $graphics.FillPath([Drawing.Brushes]::White,$outline)
      $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
      $images+=,[pscustomobject]@{Size=$size;Bytes=$memory.ToArray()}
    } finally {$memory.Dispose();$graphics.Dispose();$bitmap.Dispose()}
  }
  $iconPath=Join-Path $projectRoot 'embedded/assets/codex-startup.ico'
  $stream=[IO.File]::Create($iconPath)
  $writer=[IO.BinaryWriter]::new($stream)
  try {
    $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
    $offset=6+16*$images.Count
    foreach($entry in $images) {
      $dimension=if($entry.Size -eq 256){0}else{$entry.Size}
      $writer.Write([byte]$dimension);$writer.Write([byte]$dimension)
      $writer.Write([byte]0);$writer.Write([byte]0)
      $writer.Write([uint16]1);$writer.Write([uint16]32)
      $writer.Write([uint32]$entry.Bytes.Length);$writer.Write([uint32]$offset)
      $offset+=$entry.Bytes.Length
    }
    foreach($entry in $images){$writer.Write([byte[]]$entry.Bytes)}
  } finally {$writer.Dispose();$stream.Dispose()}
} finally {$outline.Dispose()}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path $projectRoot 'Codex.lnk'))
$shortcut.TargetPath=Join-Path $projectRoot 'Start Codex.cmd'
$shortcut.WorkingDirectory=$projectRoot
$shortcut.IconLocation=$iconPath+',0'
$shortcut.Description='Codex - AI startup animation'
$shortcut.WindowStyle=7
$shortcut.Save()
Write-Output 'Created Codex.lnk and embedded/assets/codex-startup.ico. No application was launched.'
