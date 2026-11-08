# Simplificação da Interface de Filtros Implementation Plan

> **Status: CONCLUÍDO** ✅

**Goal:** Simplificar a interface do aplicativo para um fluxo de filtro único, movendo a edição para uma modal e removendo elementos complexos (KPIs, rankings, abas).

**Architecture:**
- ✅ Removemos o sistema de abas e os painéis de análise complexos (`kpis`, `rankings`, `insights`) da interface principal.
- ✅ A tela principal terá apenas: AppBar, Lista de Colunas (filtros), Etiquetas de Filtros Ativos e Tabela de Resultados.
- ✅ O botão "Editar planilha" na AppBar abre o `editorPanel` como um modal (sobreposição).

**Tech Stack:** Vanilla JS, HTML5, CSS Grid/Flexbox.

**Spec:** Baseado na solicitação do usuário: "MUITO COMPLICADO E ELEESTA CONFUSA A USABILIDADE" e "DEIXE INTERFACE APENAS UMA LISTA PARA ESCOLHER O QUER QUER FILTRAR".

## Global Constraints
- ✅ A funcionalidade atual de leitura, filtragem e edição não foi perdida.
- ✅ O app permanece offline e sem dependências externas.
- ✅ O design é mobile-first e responsivo.

## Review Focus
- ✅ A função `applyView` foi atualizada para parar de chamar funções obsoletas.
- ✅ A navegação entre a tela de filtro e a modal de edição é fluida e fecha a modal corretamente.
- ✅ A lista de filtros ativos (chips) continua funcionando corretamente no novo layout.

---

### Task 1: Simplificação da Estrutura HTML

**Files:**
- Modified: `index.html`

- [x] **Step 1: Remover o sistema de abas e painéis desnecessários do `index.html`**
- [x] **Step 2: Mover `#editorPanel` para fora de `#workspace` (como uma modal independente)**
- [x] **Step 3: Adicionar o botão "Editar planilha" na `#appbar-actions`**
- [x] **Step 4: Commit**

### Task 2: Refatoração do Estilo CSS

**Files:**
- Modified: `css/styles.css`

- [x] **Step 1: Remover estilos específicos para `.tabs`, `.kpis`, `.insights`**
- [x] **Step 2: Ajustar o layout do `#workspace` para ser uma lista/grid simples de filtros + tabela**
- [x] **Step 3: Criar estilos para a modal de edição (`#editorPanel` como modal fixa)**
- [x] **Step 4: Commit**

### Task 3: Atualização da Lógica UI (`ui.js`)

**Files:**
- Modified: `js/ui.js`

- [x] **Step 1: Remover chamadas de funções obsoletas (`renderKpis`, `renderInsights`, `setTab`, etc) em `applyView`**
- [x] **Step 2: Implementar a lógica de abrir/fechar o modal de edição**
- [x] **Step 3: Garantir que a tabela de dados ocupe o espaço correto na nova estrutura**
- [x] **Step 4: Commit**

### Task 4: Validação e Testes

- [x] **Step 1: ✅ Rodar `node tests/core.test.js` - 20 testes passaram**
- [x] **Step 2: Conferência visual no navegador (desktop/mobile)**
- [x] **Step 3: Commit**

---

## Principais Mudanças

### HTML
- Removido sistema de abas (`.tabs`, `.tab`)
- Removido painel de KPIs e rankings
- Botão "Editar" agora está na AppBar
- Editor modal está como elemento independiente

### CSS
- Removidos estilos de KPIs (`.kpis`, `.kpi`, etc)
- Removidos estilos de insights (`.insights`, `.panel`, `.rank`, etc)
- Adicionado `.filters-area` para espaçamento da área de filtros
- Layout simplificado do `.content` para ocupar 100% da largura

### JavaScript
- Removidos listeners de `btnSettings`
- Função `setTab` substituída por `openEditorModal` e `closeEditorModal`
- Proteção adicionada para funções `renderKpis`, `buildRankControls`, `renderInsights`, `renderQuality`
- Limpeza de referências a elementos removidos do DOM