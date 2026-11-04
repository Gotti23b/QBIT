param(
  [Parameter(Mandatory=$true)][ValidateSet("observe","click","type","key")][string]$Action,
  [string]$Target = "",
  [string]$Text = ""
)
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class QbitForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
  $handle = [QbitForeground]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { throw "No hay una ventana activa." }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if ($Action -eq "observe") {
    $items = @()
    $nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $limit = [Math]::Min($nodes.Count, 100)
    for ($i=0; $i -lt $limit; $i++) {
      $n = $nodes.Item($i); $name = [string]$n.Current.Name; $id = [string]$n.Current.AutomationId
      if ($name -or $id) { $items += [pscustomobject]@{ name=$name; id=$id; type=[string]$n.Current.ControlType.ProgrammaticName; enabled=[bool]$n.Current.IsEnabled; offscreen=[bool]$n.Current.IsOffscreen } }
    }
    [pscustomobject]@{ok=$true;window=$root.Current.Name;controls=$items} | ConvertTo-Json -Depth 5 -Compress
    exit
  }
  if ($Action -eq "click") {
    if ([string]::IsNullOrWhiteSpace($Target)) { throw "Indicá el nombre o AutomationId del control." }
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $Target)
    $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -eq $found) { $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Target); $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition) }
    if ($null -eq $found) { throw "No encontré un control accesible llamado '$Target'." }
    if (-not $found.Current.IsEnabled) { throw "El control está deshabilitado." }
    $pattern = $null
    if ($found.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
    elseif ($found.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { $pattern.Toggle() }
    elseif ($found.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select() }
    else { throw "El control no ofrece una acción accesible." }
    [pscustomobject]@{ok=$true;message="Acción realizada sobre $Target."} | ConvertTo-Json -Compress
    exit
  }
  if ($Action -eq "type") {
    if ($Text.Length -gt 2000) { throw "El texto supera los 2000 caracteres." }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement; $pattern = $null
    if ($focused -and $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      if ($pattern.Current.IsReadOnly) { throw "El campo está en modo de solo lectura." }; $pattern.SetValue($Text)
    } else { throw "El campo enfocado no permite escribir mediante accesibilidad." }
    [pscustomobject]@{ok=$true;message="Texto escrito en el campo enfocado."} | ConvertTo-Json -Compress
    exit
  }
  if ($Action -eq "key") {
    $keys = @{ENTER="{ENTER}";TAB="{TAB}";ESCAPE="{ESC}";BACKSPACE="{BACKSPACE}";DELETE="{DELETE}";UP="{UP}";DOWN="{DOWN}";LEFT="{LEFT}";RIGHT="{RIGHT}";"CTRL+A"="^a";"CTRL+C"="^c";"CTRL+V"="^v"}
    $key = $Target.ToUpperInvariant(); if (-not $keys.ContainsKey($key)) { throw "Tecla no permitida." }
    [System.Windows.Forms.SendKeys]::SendWait($keys[$key])
    [pscustomobject]@{ok=$true;message="Tecla enviada: $key."} | ConvertTo-Json -Compress
    exit
  }
} catch { [pscustomobject]@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 1 }