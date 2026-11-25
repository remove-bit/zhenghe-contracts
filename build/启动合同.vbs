' 正合合同 启动器 —— 双击即用，无黑框，自动打开浏览器
' 如需修改端口，改下面的 port 值即可
Option Explicit

Dim fso, shell, here, nodeExe, appDir, port
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = fso.BuildPath(here, "node.exe")
appDir = fso.BuildPath(here, "app")
port = "3001"

If Not fso.FileExists(nodeExe) Then
    MsgBox "找不到 node.exe，请确认压缩包已完整解压。" & vbCrLf & "预期位置：" & nodeExe, 16, "正合合同 启动失败"
    WScript.Quit 1
End If
If Not fso.FileExists(fso.BuildPath(appDir, "server.js")) Then
    MsgBox "找不到主程序 app\server.js，请确认压缩包已完整解压。", 16, "正合合同 启动失败"
    WScript.Quit 1
End If

If IsPortListening(port) Then
    shell.Run "http://localhost:" & port, 1, False
    WScript.Quit 0
End If

Dim cmd
cmd = """" & nodeExe & """ """ & fso.BuildPath(appDir, "server.js") & """"
shell.CurrentDirectory = appDir
shell.Run cmd, 0, False

Dim i
For i = 1 To 40
    WScript.Sleep 300
    If IsPortListening(port) Then
        shell.Run "http://localhost:" & port, 1, False
        WScript.Quit 0
    End If
Next

MsgBox "服务已启动，但未能自动打开浏览器。" & vbCrLf & _
       "请手动访问：http://localhost:" & port, 48, "正合合同"

Function IsPortListening(p)
    On Error Resume Next
    Dim x, url
    Set x = CreateObject("MSXML2.XMLHTTP")
    url = "http://localhost:" & p & "/"
    x.Open "GET", url, True
    x.Send
    WScript.Sleep 200
    If x.readyState = 4 And Err.Number = 0 Then
        IsPortListening = True
    Else
        IsPortListening = False
    End If
    Err.Clear
    Set x = Nothing
End Function
