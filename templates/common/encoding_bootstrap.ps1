# Force UTF-8 for PowerShell sessions to prevent mojibake on Windows.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try { [Console]::InputEncoding = $utf8NoBom } catch {}
try { [Console]::OutputEncoding = $utf8NoBom } catch {}
$OutputEncoding = $utf8NoBom

$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'
$PSDefaultParameterValues['Get-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Set-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Add-Content:Encoding'] = 'utf8'
$PSDefaultParameterValues['Select-String:Encoding'] = 'utf8'
$PSDefaultParameterValues['Export-Csv:Encoding'] = 'utf8'

if ($env:OS -like '*Windows*') {
    try { chcp 65001 > $null } catch {}
}

$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
