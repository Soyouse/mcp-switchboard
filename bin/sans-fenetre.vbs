' Lance un programme console SANS ouvrir de fenetre (mode 0) et ATTEND sa fin pour en propager le code.
' Usage : wscript.exe //B //Nologo sans-fenetre.vbs <programme> <arg1> <arg2> ...
' POURQUOI : une tache planifiee Interactive qui lance node/powershell en direct ouvre une console,
' meme masquee (Windows la cree avant d'appliquer le style). Attendre + propager le code est OBLIGATOIRE :
' sinon la tache finirait toujours en succes et RestartOnFailure ne relancerait jamais un standard mort.
Dim i, a, ligne
If WScript.Arguments.Count = 0 Then WScript.Quit 2
ligne = ""
For i = 0 To WScript.Arguments.Count - 1
  a = Replace(WScript.Arguments(i), """", "")
  If ligne <> "" Then ligne = ligne & " "
  ligne = ligne & """" & a & """"
Next
WScript.Quit CreateObject("Wscript.Shell").Run(ligne, 0, True)
