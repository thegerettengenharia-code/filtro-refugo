# Simplificação da Interface de Filtros Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplificar a interface do aplicativo para um fluxo de filtro único, movendo a edição para uma modal e removendo elementos complexos (KPIs, rankings, abas).

**Architecture:**
- Removeremos o sistema de abas e os painéis de análise complexos (`kpis`, `rankings`, `insights`) da interface principal.
- A tela principal terá apenas: AppBar, Lista de Colunas (filtros), Etiquetas de Filtros Ativos e Tabela de Resultados.
- O botão "Editar planilha" na AppBar abrirá o `editorPanel` atual como um modal (sobreposição).

**Tech Stack:** Vanilla JS, HTML5, CSS Grid/Flexbox.

**Spec:** Baseado na solicitação do usuário: "MUITO COMPLICADO E ELEESTA CONFUSA A USABILIDADE" e "DEIXE INTERFACE APENAS UMA LISTA PARA ESCOLHER O QUER QUER FILTRAR".

## Global Constraints
- A funcionalidade atual de leitura, filtragem e edição não deve ser perdida.
- O app deve permanecer offline e sem dependências externas.
- O design deve ser mobile-first e responsivo.

## Review Focus
- A função `applyView` deve ser atualizada para parar de chamar funções obsoletas.
- A navegação entre a tela de filtro e a modal de edição deve ser fluida e fechar a modal corretamente.
- A lista de filtros ativos (chips) deve continuar funcionando corretamente no novo layout.

---

### Task 1: Simplificação da Estrutura HTML

**Files:**
- Modify: `app/index.html`

- [ ] **Step 1: Remover o sistema de abas e painéis desnecessários do `app/index.html`**
- [ ] **Step 2: Mover `#editorPanel` para fora de `#workspace` (como uma modal independente)**
- [ ] **Step 3: Adicionar o botão "Editar planilha" na `#appbar-actions`**
- [ ] **Step 4: Commit**

### Task 2: Refatoração do Estilo CSS

**Files:**
- Modify: `app/css/styles.css`

- [ ] **Step 1: Remover estilos específicos para `.tabs`, `.kpis`, `.insights`**
- [ ] **Step 2: Ajustar o layout do `#workspace` para ser uma lista/grid simples de filtros + tabela**
- [ ] **Step 3: Criar estilos para a modal de edição (`#editorPanel` como modal fixa)**
- [ ] **Step 4: Commit**

### Task 3: Atualização da Lógica UI (`ui.js`)

**Files:**
- Modify: `app/js/ui.js`

- [ ] **Step 1: Remover chamadas de funções obsoletas (`renderKpis`, `renderInsights`, `setTab`, etc) em `applyView`**
- [ ] **Step 2: Implementar a lógica de abrir/fechar o modal de edição**
- [ ] **Step 3: Garantir que a tabela de dados ocupe o espaço correto na nova estrutura**
- [ ] **Step 4: Commit**

### Task 4: Validação e Testes

- [ ] **Step 1: Rodar `node tests/core.test.js` para garantir que a lógica do núcleo não foi quebrada**
- [ ] **Step 2: Conferência visual no navegador (desktop/mobile)**
- [ ] **Step 3: Commit**
