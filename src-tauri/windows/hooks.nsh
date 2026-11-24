; Installer hooks (bundle.windows.nsis.installerHooks in tauri.conf.json).

; Windows keeps its own copy of an app's icon (taskbar, Start menu, pinned
; shortcuts, the tray's icon list) and doesn't always notice when an update
; changes it, so people saw the old logo after updating. Tell the shell the
; icons changed and rebuild its icon cache.
!macro NSIS_HOOK_POSTINSTALL
  ; SHCNE_ASSOCCHANGED, SHCNF_FLUSH
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  IfFileExists "$SYSDIR\ie4uinit.exe" 0 +2
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
!macroend
