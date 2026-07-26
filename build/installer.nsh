!macro customHeader
  ShowInstDetails show
!macroend

!macro customInit
  ReadRegStr $R9 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${if} $R9 == "0.1.21"
    ${ifNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      DetailPrint "Recovering incomplete Caul 0.1.21 installation..."
      DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
      DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
    ${endIf}
  ${endIf}
!macroend

!macro customInstall
  DetailPrint "Finishing Caul installation..."
!macroend
