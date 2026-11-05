param(
  [Parameter(Mandatory=$true)][ValidateSet("observe","click","type","key","scroll","click_at")][string]$Action,
  [string]$Target = "",
  [string]$Text = "",
  [string]$Direction = "",
  [int]$Amount = 1,
  [int]$X = -1,
  [int]$Y = -1
)
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class QbitInput {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
}
"@
  $handle = [QbitInput]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { throw "No hay una ventana activa." }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if ($Action -eq "observe") {
    $items = @()
    $nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $limit = [Math]::Min($nodes.Count, 80)
    for ($i=0; $i -lt $limit; $i++) {
      try {
        $n = $nodes.Item($i); $c = $n.Current
        $name = [string]$c.Name; $id = [string]$c.AutomationId
        $rect = $c.BoundingRectangle
        $value = ""
        $vp = $null
        if ($n.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
          try { $value = [string]$vp.Current.Value } catch {}
        }
        if (($name -or $id -or $value) -and -not $c.IsOffscreen -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
          $items += [pscustomobject]@{
            name=$name; id=$id; type=[string]$c.ControlType.ProgrammaticName
            enabled=[bool]$c.IsEnabled; focused=[bool]$c.HasKeyboardFocus
            rect=@{x=[math]::Round($rect.X);y=[math]::Round($rect.Y);width=[math]::Round($rect.Width);height=[math]::Round($rect.Height)}
            value=if($value.Length -gt 240){$value.Substring(0,240)}else{$value}
          }
        }
      } catch {}
    }
    $bounds = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height;primary=$_.Primary} }
    [pscustomobject]@{ok=$true;window=$root.Current.Name;screens=@($bounds);controls=$items;truncated=($nodes.Count -gt $limit)} | ConvertTo-Json -Depth 7 -Compress
    exit
  }
  if ($Action -eq "click") {
    if ([string]::IsNullOrWhiteSpace($Target)) { throw "Indicá el nombre o AutomationId del control." }
    $found = $null
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $Target)
    $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -eq $found) {
      $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Target)
      $matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      $usable = @()
      for ($i=0; $i -lt $matches.Count; $i++) {
        $m=$matches.Item($i)
        if ($m.Current.IsEnabled -and -not $m.Current.IsOffscreen) { $usable += $m }
      }
      if ($usable.Count -gt 1) {
        $options = @($usable | Select-Object -First 8 | ForEach-Object { @{id=$_.Current.AutomationId;name=$_.Current.Name;type=$_.Current.ControlType.ProgrammaticName} })
        [pscustomobject]@{ok=$false;error="Hay varios controles con ese nombre. Usá un AutomationId o computer_click_at con coordenadas observadas.";candidates=$options} | ConvertTo-Json -Depth 5 -Compress
        exit 1
      }
      if ($usable.Count -eq 1) { $found = $usable[0] }
    }
    if ($null -eq $found) { throw "No encontré un control accesible llamado '$Target'." }
    if (-not $found.Current.IsEnabled -or $found.Current.IsOffscreen) { throw "El control está deshabilitado o fuera de pantalla." }
    $pattern = $null
    if ($found.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
    elseif ($found.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle() }
    elseif ($found.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select() }
    elseif ($found.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
      if ($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $pattern.Expand() } else { $pattern.Collapse() }
    } else {
      $r=$found.Current.BoundingRectangle
      if ($r.Width -le 0 -or $r.Height -le 0) { throw "El control no ofrece una acción accesible ni tiene coordenadas válidas." }
      [void][QbitInput]::SetCursorPos([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2))
      [QbitInput]::mouse_event([QbitInput]::LEFTDOWN,0,0,0,[UIntPtr]::Zero)
      [QbitInput]::mouse_event([QbitInput]::LEFTUP,0,0,0,[UIntPtr]::Zero)
    }
    [pscustomobject]@{ok=$true;message="Acción realizada sobre $Target."} | ConvertTo-Json -Compress
    exit
  }
  if ($Action -eq "click_at") {
    $screens=[System.Windows.Forms.Screen]::AllScreens
    $valid=$false
    foreach($s in $screens){if($X -ge $s.Bounds.Left -and $X -lt $s.Bounds.Right -and $Y -ge $s.Bounds.Top -and $Y -lt $s.Bounds.Bottom){$valid=$true;break}}
    if(-not $valid){throw "Las coordenadas están fuera de los monitores conectados."}
    [void][QbitInput]::SetCursorPos($X,$Y)
    [QbitInput]::mouse_event([QbitInput]::LEFTDOWN,0,0,0,[UIntPtr]::Zero)
    [QbitInput]::mouse_event([QbitInput]::LEFTUP,0,0,0,[UIntPtr]::Zero)
    [pscustomobject]@{ok=$true;message="Clic realizado en ($X, $Y)."} | ConvertTo-Json -Compress
    exit
  }
  if ($Action -eq "type") {
    if ($Text.Length -gt 2000) { throw "El texto supera los 2000 caracteres." }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $pattern = $null
    if ($focused -and $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      if ($pattern.Current.IsReadOnly) { throw "El campo está en modo de solo lectura." }
      $pattern.SetValue($Text)
    } elseif ($focused) {
      [void]$focused.SetFocus()
      $escaped = [regex]::Replace($Text, '([+^%~(){}])', '{$1}')
      [System.Windows.Forms.SendKeys]::SendWait($escaped)
    } else { throw "No hay un campo enfocado donde escribir." }
    [pscustomobject]@{ok=$true;message="Texto escrito en el campo enfocado."} | ConvertTo-Json -Compress
    exit
  }
  if ($Action -eq "scroll") {
    if (-not @("up","down","left","right").Contains($Direction.ToLowerInvariant())) { throw "Dirección no válida. Usá up, down, left o right." }
    $Amount=[Math]::Max(1,[Math]::Min(10,$Amount))
    $element=$null
    if ($Target) {
      $cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$Target)
      $element=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)
      if($null -eq $element){$cond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$Target);$element=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$cond)}
    } else { $element=[System.Windows.Automation.AutomationElement]::FocusedElement }
    $sp=$null
    if($element -and $element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern,[ref]$sp)){
      for($i=0;$i -lt $Amount;$i++){
        if($Direction -eq "up"){$sp.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,[System.Windows.Automation.ScrollAmount]::SmallDecrement)}
        elseif($Direction -eq "down"){$sp.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,[System.Windows.Automation.ScrollAmount]::SmallIncrement)}
        elseif($Direction -eq "left"){$sp.Scroll([System.Windows.Automation.ScrollAmount]::SmallDecrement,[System.Windows.Automation.ScrollAmount]::NoAmount)}
        else{$sp.Scroll([System.Windows.Automation.ScrollAmount]::SmallIncrement,[System.Windows.Automation.ScrollAmount]::NoAmount)}
      }
    } else {
      $key=switch($Direction){ "up"{"{PGUP}"} "down"{"{PGDN}"} "left"{"{LEFT}"} "right"{"{RIGHT}"} }
      for($i=0;$i -lt $Amount;$i++){[System.Windows.Forms.SendKeys]::SendWait($key)}
    }
    [pscustomobject]@{ok=$true;message="Desplazamiento $Direction realizado ($Amount)."} | ConvertTo-Json -Compress
    exit
  }
  if ($Action -eq "key") {
    $keys = @{
      ENTER="{ENTER}";TAB="{TAB}";ESCAPE="{ESC}";BACKSPACE="{BACKSPACE}";DELETE="{DELETE}"
      UP="{UP}";DOWN="{DOWN}";LEFT="{LEFT}";RIGHT="{RIGHT}"
      HOME="{HOME}";END="{END}";PAGEUP="{PGUP}";PAGEDOWN="{PGDN}";SPACE=" "
      "CTRL+A"="^a";"CTRL+C"="^c";"CTRL+V"="^v";"CTRL+Z"="^z";"CTRL+Y"="^y";F5="{F5}"
    }
    $key = $Target.ToUpperInvariant()
    if (-not $keys.ContainsKey($key)) { throw "Tecla no permitida." }
    [System.Windows.Forms.SendKeys]::SendWait($keys[$key])
    [pscustomobject]@{ok=$true;message="Tecla enviada: $key."} | ConvertTo-Json -Compress
    exit
  }
} catch { [pscustomobject]@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Depth 5 -Compress; exit 1 }
