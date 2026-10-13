; Bagscope setup wizard additions (electron-builder NSIS hooks).
; Flow: Welcome -> Choose install folder -> Shortcuts -> Installing -> Finish.

; Install for the current Windows user only: no admin prompt, no "who is this for" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Bagscope"
  !define MUI_WELCOMEPAGE_TEXT "All your Phantom wallets in one place, with real balances and real prices.$\r$\n$\r$\nSetup will let you choose where to install Bagscope and whether you want a desktop shortcut.$\r$\n$\r$\nBagscope never asks for a seed phrase or private key.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Extra page shown after the folder is chosen and before files are copied.
!macro customPageAfterChangeDir
  Var BagscopeDesktopCheckbox
  Var BagscopeDesktopShortcut

  Page custom BagscopeShortcutsShow BagscopeShortcutsLeave

  Function BagscopeShortcutsShow
    ; Updates keep whatever the user chose the first time.
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose how you want to open Bagscope."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 24u "Bagscope is always added to the Start menu. You can also put a shortcut on your desktop."
    Pop $0
    ${NSD_CreateCheckbox} 0 34u 100% 12u "Create a &desktop shortcut"
    Pop $BagscopeDesktopCheckbox
    ${if} $BagscopeDesktopShortcut != ${BST_UNCHECKED}
      ${NSD_Check} $BagscopeDesktopCheckbox
    ${endif}
    nsDialogs::Show
  FunctionEnd

  Function BagscopeShortcutsLeave
    ${NSD_GetState} $BagscopeDesktopCheckbox $BagscopeDesktopShortcut
  FunctionEnd
!macroend

; Runs after the default shortcuts are created; remove the desktop one if it was not wanted.
!macro customInstall
  ${if} $BagscopeDesktopShortcut == ${BST_UNCHECKED}
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
  ${endif}
  ; The program file is shipped byte-for-byte as published by Electron so Windows
  ; recognises it, which means it carries no custom icon. Point the shortcuts at ours.
  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endif}
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endif}
!macroend
