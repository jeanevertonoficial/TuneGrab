; Desinstalar o TuneGrab de verdade: tira também o "abrir junto com o Windows".
; Numa atualização (o instalador novo roda o desinstalador antigo com --updated) não mexe em nada.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.jeaneverton.tunegrab"
  ${EndIf}
!macroend
