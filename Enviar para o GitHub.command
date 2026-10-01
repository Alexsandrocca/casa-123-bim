#!/bin/bash
# Dois cliques no Finder para enviar o projeto Casa 123 ao GitHub (repositório privado casa-123-bim).
# Na primeira vez, abre o navegador para você entrar no GitHub. Depois disso, só envia.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v gh >/dev/null 2>&1; then
  echo "Instalando a ferramenta do GitHub (só na primeira vez, leva um minuto)..."
  brew install gh || { echo "Não consegui instalar. Feche esta janela e avise o Claude."; read -r; exit 1; }
fi

if ! gh auth status >/dev/null 2>&1; then
  echo ""
  echo "Vou abrir o navegador para você entrar no GitHub."
  echo "1. Aperte Enter quando a janela pedir."
  echo "2. Copie o código de 8 letras que aparecer aqui e cole na página do GitHub."
  echo "3. Clique em Authorize."
  echo ""
  gh auth login --hostname github.com --git-protocol https --web || { echo "Login não concluído. Feche e tente de novo."; read -r; exit 1; }
fi

gh auth setup-git
echo ""
echo "Enviando..."
if git push -u origin --all; then
  echo ""
  echo "Pronto. O projeto está em https://github.com/Alexsandrocca/casa-123-bim"
else
  echo ""
  echo "O envio falhou. Feche esta janela e avise o Claude."
fi
echo "Pode fechar esta janela."
read -r
