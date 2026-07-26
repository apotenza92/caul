!macro customHeader
  ShowInstDetails show
!macroend

!macro customInit
  ReadRegStr $R9 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${if} $R9 == "0.1.21"
    DetailPrint "Migrating Caul 0.1.21 installation..."
    DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
  ${endIf}
!macroend

!macro customInstall
  DetailPrint "Finishing Caul installation..."
!macroend
