$ErrorActionPreference = "Stop"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 17614)
$pending = [System.Collections.Concurrent.ConcurrentDictionary[string, object]]::new()

function Read-Exact($stream, [int]$count) {
  $bytes = [byte[]]::new($count)
  $offset = 0
  while ($offset -lt $count) {
    $read = $stream.Read($bytes, $offset, $count - $offset)
    if ($read -le 0) { throw "Conexión cerrada." }
    $offset += $read
  }
  return ,$bytes
}

function Send-Frame($stream, [byte]$opcode, [byte[]]$payload) {
  $length = $payload.Length
  $header = [System.Collections.Generic.List[byte]]::new()
  $header.Add([byte](0x80 -bor $opcode))
  if ($length -lt 126) { $header.Add([byte]$length) }
  elseif ($length -le 65535) {
    $header.Add([byte]126)
    $header.Add([byte](($length -shr 8) -band 255))
    $header.Add([byte]($length -band 255))
  } else {
    $header.Add([byte]127)
    $unsignedLength = [UInt64]$length
    foreach ($shift in @(56, 48, 40, 32, 24, 16, 8, 0)) { $header.Add([byte](($unsignedLength -shr $shift) -band 255)) }
  }
  $headBytes = $header.ToArray()
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($length) { $stream.Write($payload, 0, $length) }
  $stream.Flush()
}

function Send-Json($stream, $value) {
  $json = $value | ConvertTo-Json -Compress -Depth 8
  Send-Frame $stream 1 ([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Receive-Json($stream) {
  $assembled = [System.IO.MemoryStream]::new()
  $firstOpcode = 0
  while ($true) {
    $header = Read-Exact $stream 2
    $fin = (($header[0] -band 0x80) -ne 0)
    $opcode = [int]($header[0] -band 0x0F)
    $masked = (($header[1] -band 0x80) -ne 0)
    $length = [int]($header[1] -band 0x7F)
    if ($length -eq 126) {
      $extended = Read-Exact $stream 2
      $length = ([int]$extended[0] -shl 8) -bor [int]$extended[1]
    } elseif ($length -eq 127) { throw "Tamaño de mensaje no permitido." }
    if ($length -gt 32768) { throw "Mensaje demasiado grande." }
    $mask = if ($masked) { Read-Exact $stream 4 } else { $null }
    $payload = if ($length) { Read-Exact $stream $length } else { [byte[]]::new(0) }
    if ($masked) { for ($i = 0; $i -lt $payload.Length; $i++) { $payload[$i] = [byte]($payload[$i] -bxor $mask[$i % 4]) } }
    if ($opcode -eq 8) { return $null }
    if ($opcode -eq 9) { Send-Frame $stream 10 $payload; continue }
    if ($opcode -eq 10) { continue }
    if ($opcode -eq 1) { $firstOpcode = 1 }
    if ($opcode -eq 0 -or $opcode -eq 1) { $assembled.Write($payload, 0, $payload.Length) }
    if ($assembled.Length -gt 32768) { throw "Mensaje demasiado grande." }
    if ($fin -and $firstOpcode -eq 1) { break }
  }
  $text = [System.Text.Encoding]::UTF8.GetString($assembled.ToArray())
  $assembled.Dispose()
  return $text | ConvertFrom-Json
}

function Handle-Message($message, $stream) {
  switch ([string]$message.type) {
    "hello" {
      Write-Host "[QBIT Console] Extensión conectada ($($message.version))." -ForegroundColor Green
      Send-Json $stream @{ type = "hello_ack" }
    }
    "qbit_prompt" {
      $id = [string]$message.id
      $text = [string]$message.message
      if (-not $id -or -not $text.Trim() -or $text.Length -gt 12000) {
        Send-Json $stream @{ type = "result"; id = $id; ok = $false; error = "La solicitud de QBIT no es válida." }
        return
      }
      $pending[$id] = $true
      Write-Host "[QBIT] $($text.Substring(0, [Math]::Min(120, $text.Length)))" -ForegroundColor Cyan
      Send-Json $stream @{ type = "dispatch_ai"; id = $id; provider = "auto"; message = $text }
    }
    "ai_result" {
      $id = [string]$message.id
      $ignored = $null
      if ($pending.TryRemove($id, [ref]$ignored)) {
        if ($message.ok) {
          Write-Host "[IA] Respuesta recibida." -ForegroundColor Green
          Send-Json $stream @{ type = "result"; id = $id; ok = $true; answer = [string]$message.answer; provider = [string]$message.provider }
        } else {
          $errorText = [string]$message.error
          Write-Host "[IA] $errorText" -ForegroundColor Yellow
          Send-Json $stream @{ type = "result"; id = $id; ok = $false; error = $errorText }
        }
      }
    }
    "ping" { Send-Json $stream @{ type = "pong" } }
    default { Write-Host "[QBIT Console] Mensaje ignorado: $($message.type)" -ForegroundColor DarkGray }
  }
}

function Start-WebSocket($client) {
  $stream = $client.GetStream()
  $stream.ReadTimeout = 180000
  $request = [System.Text.StringBuilder]::new()
  $one = [byte[]]::new(1)
  while ($request.Length -lt 8192) {
    if ($stream.Read($one, 0, 1) -ne 1) { throw "No se recibió el encabezado WebSocket." }
    [void]$request.Append([char]$one[0])
    if ($request.ToString().EndsWith("`r`n`r`n")) { break }
  }
  $headerText = $request.ToString()
  if ($headerText -notmatch '(?im)^GET /qbit-console HTTP/1\.1') { throw "Ruta WebSocket incorrecta." }
  $keyMatch = [regex]::Match($headerText, '(?im)^Sec-WebSocket-Key:\s*(.+?)\s*$')
  $originMatch = [regex]::Match($headerText, '(?im)^Origin:\s*(.+?)\s*$')
  if (-not $keyMatch.Success) { throw "Falta la clave de WebSocket." }
  if (-not $originMatch.Success -or $originMatch.Groups[1].Value.Trim() -notmatch '^chrome-extension://[a-p]{32}$') { throw "Origen rechazado: se requiere la extensión QBIT." }
  $acceptSource = $keyMatch.Groups[1].Value.Trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try { $accept = [Convert]::ToBase64String($sha.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($acceptSource))) }
  finally { $sha.Dispose() }
  $response = "HTTP/1.1 101 Switching Protocols`r`nUpgrade: websocket`r`nConnection: Upgrade`r`nSec-WebSocket-Accept: $accept`r`n`r`n"
  $responseBytes = [System.Text.Encoding]::ASCII.GetBytes($response)
  $stream.Write($responseBytes, 0, $responseBytes.Length)
  $stream.Flush()
  Write-Host "[QBIT Console] Canal local abierto." -ForegroundColor Green
  while ($client.Connected) {
    $message = Receive-Json $stream
    if ($null -eq $message) { break }
    Handle-Message $message $stream
  }
}

Write-Host "QBIT Console — escuchando solo en 127.0.0.1:17614" -ForegroundColor Cyan
Write-Host "Dejá esta ventana abierta. Cerrala con Ctrl+C." -ForegroundColor Gray
try {
  $listener.Start()
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try { Start-WebSocket $client }
    catch { Write-Host "[QBIT Console] Canal cerrado: $($_.Exception.Message)" -ForegroundColor DarkYellow }
    finally {
      foreach ($key in @($pending.Keys)) { $ignored = $null; $null = $pending.TryRemove($key, [ref]$ignored) }
      $client.Close()
      Write-Host "[QBIT Console] Esperando reconexión de la extensión…" -ForegroundColor Gray
    }
  }
} finally { $listener.Stop() }
