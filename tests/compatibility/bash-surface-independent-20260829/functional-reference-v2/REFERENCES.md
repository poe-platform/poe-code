# Wrapper transport source reference

Primary zsh documentation, retrieved August29,2026 through web.run:
https://zsh.sourceforge.io/Doc/Release/Redirection.html
https://zsh.sourceforge.io/Doc/Release/Shell-Grammar.html

The manual describes > as refusing existing files with CLOBBER unset, <> as read/write opening without truncation, and MULTIOS as introducing copy processes for multiple redirections. The fixed proposed wrapper disables MULTIOS, performs noclobber creation before read/write reopening, and exec-replaces the tool shell. These are SOURCE semantics, not a new installed-zsh runtime qualification or hostile-directory race defense. No wrapper was executed. Captured Bash3.2.57 identity remains inherited evidence, not a repeated version probe.
