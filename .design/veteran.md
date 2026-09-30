# Veteran

> Plan this with **tlc-plan**.
> Decisions below carry the literal shape - copy them, do not re-derive them.

Veteran é o "dev sênior veterano" que responde, para pessoas não técnicas, perguntas sobre regras de negócio que só estão documentadas no código. Ele responde na linguagem do negócio, sem entregar trechos de código, nomes internos ou segredos. O projeto é agnóstico de codebase: tudo que é específico de um projeto vive num **perfil** fora deste repositório.

## Situation

- Project: não entregue. O repositório está vazio (sem commits), e o remote é `github.com/obogoni/veteran`, pessoal.
- Decision: construir foi decidido pelo autor em 2026-09-30, a partir de um roadmap de 7 fases (eval set → PoC headless → hardening → serviço → bot → MCP → operação).
- In flight: já existe, no codebase-alvo, uma skill de "explicação funcional" usada por devs dentro do Claude Code. Ela tem 13 evals de formato (sem resposta de referência e sem casos adversariais) e termina oferecendo "detalhes técnicos sob pedido". O Veteran reaproveita o conteúdo dela (fluxo de análise, regras de estilo, mapa de módulos) como o primeiro perfil, mas **remove essa oferta de detalhes técnicos**.
- At stake: é um custo, mas não é irreversível. O público é interno (suporte), então vazar um nome de tabela vira ruído, não incidente. Vazar um segredo (connection string, chave de gateway) é irreversível em qualquer caso. O código pertence ao empregador, e isso condiciona **onde** o serviço pode rodar (ver Needs an RFC).

## Problem

É um problema de construção sobre uma dor que já existe. Hoje o fluxo é: o suporte pergunta a um dev, o dev roda a skill no Claude Code e repassa a resposta. Quando a resposta contradiz o que o suporte observa, o dev volta à IA e repassa de novo. O dev virou um proxy humano de uma conversa que o suporte poderia ter sozinho.

O caso real que motivou o projeto: o suporte perguntou "a devolução de cartão desativa o cartão?". A resposta foi "sim". O suporte respondeu "desativa não", e só depois apareceu que o comportamento depende do tipo do cartão. A falha foi ter respondido sem separar os casos. Vazamento de código não foi o problema.

Existe uma segunda dor: antes de perguntar, o suporte perde tempo **testando cenários na mão**, porque não sabe quais variações importam.

Sem o Veteran, cada dúvida continua custando uma interrupção de dev, mais uma a cada ida e volta, e o suporte continua testando às cegas.

## Evidence

- Volume de perguntas por semana e minutos de dev por pergunta: **ninguém mede**. O autor estima que é alto, mas isso é falta de medição, não sinal de que o problema é pequeno. Para medir, o próprio Veteran registra conversas e escalonamentos (ver Success).
- Tempo que o suporte gasta testando antes de perguntar: não medido, e só dá para saber perguntando ao suporte no piloto.
- O codebase-alvo tem ~21 GB e mais de 100 branches de patch por cliente, com commits até 2026-07. O comportamento pode variar por cliente. Isso cria uma ressalva obrigatória em toda resposta e significa que as buscas serão lentas (de dezenas de segundos a minutos).
- A skill existente foi escrita por um único autor, em 8 commits: é um conteúdo estável que dá para reaproveitar como perfil.

## Journey

Sequência confirmada: um analista de suporte faz uma pergunta em linguagem natural → espera → recebe a resposta → segue a conversa sozinho até resolver ou escalar para um dev.

- **Pergunta enviada:** confirma na hora ("analisando, costuma levar 1–2 min") e mostra progresso. Uma espera silenciosa de minutos faz parecer que travou.
- **Comportamento que depende de tipo, configuração ou dado:** responde **por ramo** ("tipo A: não desativa; tipo B: desativa; checkout e perda: sempre desativam"). Cada ramo vira um **cenário de teste sugerido**, o que resolve a segunda dor.
- **Pergunta ambígua demais para separar em ramos:** faz **uma** pergunta de esclarecimento em vez de escolher um caso.
- **Contradição ("não é isso que vejo"):** o suporte responde na mesma conversa com o contexto novo, e o Veteran reanalisa com o histórico. Esse é o estado principal do produto.
- **Observado diferente do código:** a resposta diz o que o código faz na versão atual e que a diferença pode ser um defeito ou um patch específico do cliente. Não afirma qual dos dois.
- **Código não cobre (comportamento vem de configuração ou dado):** diz que "isso depende de configuração/dado", diz qual, e não inventa.
- **Pedido de código, tabela, arquivo ou segredo:** recusa curta, e oferece a explicação funcional no lugar.
- **Validação reprova duas vezes:** fallback fixo ("não consegui responder com segurança, leve a um dev") e um texto de escalonamento pronto para colar.
- **Conversa retomada no dia seguinte:** a conversa fica disponível por 7 dias e depois começa do zero.
- **Toda resposta** carrega a ressalva de versão: "comportamento da versão atual; clientes com patch próprio podem diferir".

## Verdict

Já decidido, ver Situation.

Caminhos mais baratos considerados:
- Dar ao suporte o Claude Code com a skill existente num clone só de leitura. Tira o gargalo em um dia, mas dá ao suporte shell e o código inteiro, e a skill oferece detalhes técnicos. É exatamente o que o projeto existe para evitar. Descartado como produto.
- FAQ curada escrita pelos devs. Não cobre a cauda longa, que é de onde vem o caso real. Fica como a Fase 7 do roadmap (base de conhecimento consultada primeiro), não como substituto.
- Comprar: existem produtos de perguntas e respostas sobre código, mas voltados a devs, e eles mostram código. Não fiz um levantamento. Não conheço nenhum voltado a público não técnico com garantia de não mostrar código, e isso não foi verificado.

## Success

- Worked if: nas 4 primeiras semanas de piloto, ≥ 70% das conversas do suporte terminam sem escalonar para um dev.
- Early signal: na primeira semana, o suporte confirma no ambiente de teste as respostas por ramo. Se mais de 1 em cada 5 respostas voltar com "não é isso que vejo", a aposta está indo mal.
- Review: 4 semanas depois do início do piloto. Quem avalia: o autor.
- Não medível hoje: não existe o número "antes". O proxy é a queda nas mensagens "me tira uma dúvida" recebidas pelos devs no chat. A instrumentação (registro de conversa, botão e contagem de escalonamento, polegar para cima e para baixo) faz parte deste trabalho.
- Antes do piloto (gate de qualidade, não de sucesso): acurácia ≥ 80% no eval set real e 0 vazamentos de segredo no conjunto adversarial.

## Boundary

In: eval set, PoC headless, perfil de projeto, snapshot filtrado do código, sandbox, validação de entrada e saída, conversa com várias trocas, e um canal mínimo para o suporte usar no piloto.
Out:
- Resposta por versão ou branch do cliente: responde contra o branch principal, com ressalva. Vira uma discovery própria depois do piloto.
- Público externo (clientes): exigiria outro nível de validação e uma discovery própria.
- Servidor MCP: vem depois que o serviço estiver estável (Fase 6 do roadmap).
- Base de conhecimento curada: Fase 7, alimentada pelos logs do piloto.
- Fila assíncrona, orçamento diário e SSO: o volume do piloto (poucos analistas) não justifica.

## Prior art

- Roadmap de origem (Fases 0–7): tomamos a ordem (eval antes do produto, sandbox antes de expor) e o pipeline de validação em camadas com fail closed.
- Falha relatada no próprio roadmap: uma instrução no prompt não é garantia. Aqui isso vira uma exclusão **física** de caminhos no snapshot, e não uma regra no prompt.
- O roadmap assume uma empresa com SSO, fila e bot de chat corporativo. Não compartilhamos a escala nem o SSO, então o formato fica em um processo só.
- Pesquisa na web de outros produtos: não verificado. Só a documentação do Agent SDK foi consultada.

## Shape

A aposta: **um processo TypeScript só**, com a Agent SDK rodando um único agente de leitura sobre um **snapshot filtrado** do codebase. Todo o conhecimento específico do projeto fica num **perfil externo** ao repositório. A mesma função `ask` atende a CLI, o runner de evals e, depois, o chat do piloto. Mudar depois custa pouco no transporte (CLI → HTTP → bot) e caro no formato da resposta (o schema). Por isso o schema é decidido aqui.

### Adds

- `package.json`, `tsconfig.json`: projeto Node/TypeScript com a dependência `@anthropic-ai/claude-agent-sdk`.
- `src/profile/loadProfile.ts`: lê `<VETERAN_PROFILE_DIR>/profile.yaml` (campos em Decisions).
- `src/snapshot/buildSnapshot.ts`: comando `veteran snapshot`. Copia o `ref` do perfil para `<VETERAN_PROFILE_DIR>/snapshot/` aplicando `excludePaths`, roda o gitleaks e **aborta** se encontrar algo.
- `src/agent/ask.ts`: `ask({ profile, question, sessionId? }) → VeteranAnswer` via `query()`, com as opções literais de Decisions.
- `src/agent/answerSchema.ts`: JSON Schema de `VeteranAnswer`.
- `src/validate/deterministic.ts`: bloqueia cercas de código, caminhos de arquivo, identificadores CamelCase/snake_case com ponto ou parênteses, palavras-chave SQL, formatos de stack trace, padrões de segredo e termos da `denyTerms` do perfil.
- `src/validate/judge.ts`: uma chamada de juiz ("revela detalhe de implementação além do comportamento de negócio?").
- `src/validate/pipeline.ts`: determinístico → juiz → se reprovar, regenera uma vez com feedback → se reprovar de novo, fallback. Nunca devolve uma resposta reprovada.
- `src/transcripts/writeTranscript.ts`: um JSONL por execução em `<VETERAN_PROFILE_DIR>/transcripts/`, com as mensagens da SDK, `total_cost_usd`, `duration_ms` e o resultado de cada validação.
- `src/evals/runEvals.ts` + `src/evals/rubricJudge.ts`: comando `veteran eval`. Roda `<VETERAN_PROFILE_DIR>/evals/*.jsonl` e informa acurácia, taxa de vazamento, custo e latência (p50/p95).
- `src/cli.ts`: `veteran ask "<pergunta>" [--session <id>]`, `veteran eval`, `veteran snapshot`.
- `Dockerfile` + `compose.yaml`: usuário não root, snapshot montado só para leitura em `/repo`, saída de rede liberada apenas para `api.anthropic.com`.
- `profiles/example/`: um perfil de exemplo com um codebase público pequeno. O perfil real nunca entra no git.
- `.gitignore`: ignora `profiles/*` exceto `profiles/example/`, além de `snapshot/` e `transcripts/`.

### Changes

Nada. O repositório está vazio.

### Leaves

- Resolução por cliente ou versão, MCP, fila assíncrona, SSO e base curada: listados em Boundary Out.
- A skill existente no codebase-alvo continua como está, para os devs. O Veteran só copia o conteúdo dela para o perfil.

Cada estado do Journey tem onde ser tratado: resposta por ramo, cenários de teste e pergunta de esclarecimento → campos `branches`, `suggestedTests` e `clarifyingQuestion` do schema. Contradição e retomada → `sessionId`/`resume`. Pedido de código e fallback → `pipeline.ts`. "Depende de configuração" → `dependsOn`. Ressalva de versão → `versionCaveat`, preenchido pelo perfil e não pelo modelo. Confirmação imediata e progresso → canal (Needs design).

A alternativa mais pesada é o roadmap completo: serviço HTTP assíncrono com fila e worker separado, bot no chat corporativo, SSO e um worktree por versão de cliente. Ela ganha quando houver dezenas de usuários simultâneos ou quando a resposta por cliente for obrigatória. Hoje o piloto tem poucos analistas e a versão por cliente está fora do escopo. O formato leve não aguenta respostas por cliente nem concorrência alta. O que forçaria reescrever seria abrir para muitos times ao mesmo tempo, e mesmo assim `ask` e `pipeline` sobrevivem: só o transporte muda.

Também existem no mercado, só como referência e não como candidatos: RAG com embeddings do código, descartado porque "depende do tipo" exige seguir o fluxo, não achar trechos parecidos. E orquestração com vários agentes, descartada porque o roadmap manda só dividir quando um eval mostrar uma falha que a divisão corrige.

## Roadmap

| Block | Delivers | Clarity |
|---|---|---|
| 1. Perfil + snapshot filtrado | `veteran snapshot` gera um snapshot sem caminhos excluídos e sem segredos detectados; o perfil de exemplo funciona | clear |
| 2. Eval set | ≥ 40 perguntas reais (do histórico de chat, com a resposta que o dev deu) + ≥ 20 adversariais, e rubrica, no perfil real | clear |
| 3. PoC headless | `veteran ask` responde no schema e grava o transcript; `veteran eval` informa acurácia, custo e latência | clear |
| 4. Validação de saída | `pipeline.ts` com fail closed; taxa de vazamento como métrica separada no `veteran eval` | clear |
| 5. Sandbox | `compose.yaml` roda `ask` como usuário não root, com leitura apenas e saída de rede só para a API | clear |
| 6. Conversa com várias trocas | follow-ups com `resume` mantêm a qualidade no caso da contradição | spike |
| 7. Onde o piloto roda | decisão autorizada sobre a máquina/infra que hospeda o código do empregador | rfc |
| 8. Canal do suporte | o suporte conversa sem dev no meio: confirmação, progresso, ramos, escalonamento | design |

## Decisions

| Decision | Choice | Why this | Alternative, and what would make it win | Reversibility |
|---|---|---|---|---|
| Linguagem e runtime | TypeScript em Node, `@anthropic-ai/claude-agent-sdk` | A mesma linguagem para agente, validação e o chat web do piloto | Python SDK, se o autor preferir; não há código ainda | costly |
| Ferramentas do agente | `tools: ["Read", "Grep", "Glob"]`, `disallowedTools: ["Bash", "Write", "Edit", "WebFetch", "WebSearch"]` | O que o agente não alcança não vaza; `allowedTools` sozinho não restringe | Nenhuma: shell "só para grep" é o anti-padrão do roadmap | reversible |
| Isolamento de configuração | `settingSources: []`, `cwd: "/repo"` | O codebase-alvo tem arquivos de instrução para agentes; carregá-los seria injeção vinda do próprio repositório | Nenhuma | reversible |
| Limites por execução | `maxTurns: 40`, `maxBudgetUsd: 1.00`, timeout de 5 min no chamador | Um repositório grande faz o agente vagar; os valores serão recalibrados pelo p95 do eval | Mais altos, se o eval mostrar respostas truncadas | reversible |
| Formato da resposta | `outputFormat: { type: "json_schema", schema }` com `VeteranAnswer = { answer: string, branches: {condition: string, behavior: string}[], suggestedTests: string[], clarifyingQuestion: string \| null, confidence: "high" \| "medium" \| "low", dependsOn: string[], caveats: string[], internalReferences: string[] }`; `versionCaveat` é anexado pelo serviço | Resposta por ramo e cenários de teste saem do schema, não do texto livre; `internalReferences` nunca sai para o suporte | Texto livre, se o schema degradar a qualidade no eval | costly |
| Conversa | `resume: <sessionId>` da SDK; sessão válida por 7 dias | A contradição é o estado central; a sessão guarda o que já foi lido | Reenviar o histórico resumido em cada pergunta, se o spike 6 mostrar custo ou qualidade ruins | reversible |
| Exclusão de caminhos | Física: `excludePaths` aplicado na cópia do snapshot + gitleaks aborta o snapshot | "Se o agente não consegue ler, nenhuma injeção extrai" | Deny por ferramenta: rejeitada, porque depende da SDK obedecer | costly |
| Perfil | `profile.yaml`: `name`, `repoPath`, `ref`, `language: "pt-BR"`, `instructions: [arquivos .md]`, `excludePaths: [glob]`, `denyTerms: [string]`, `versionCaveat: string`; diretório via `VETERAN_PROFILE_DIR` | Agnóstico por fronteira, sem generalizar antes do 2º codebase; o perfil real fica fora do repo pessoal | Um perfil por codebase dentro do repo: só para codebases públicos | costly |
| Modelos | Agente `claude-opus-5-5`; juízes (validação e rubrica) `claude-sonnet-5-5` | Ler o código com precisão é o gargalo; o juiz faz uma classificação barata | Juiz no Opus, se a concordância com o dev ficar abaixo de 80% | reversible |
| Fail closed | 1 regeneração com feedback; se reprovar de novo, fallback fixo + texto de escalonamento | Nunca entregar uma resposta reprovada | Nenhuma | reversible |
| Versão do código | `ref` do perfil = branch principal; `versionCaveat` em toda resposta | Resolver cliente → branch dobra a infraestrutura antes de provar a acurácia | Resolução por cliente, quando o piloto mostrar erros causados por patch | reversible |
| Acompanhamento do trabalho | Uma issue no GitHub por bloco do Roadmap, com link para a seção deste doc, sem nomes nem dados do codebase-alvo | O repositório é pessoal e público | — | reversible |

## Needs an RFC

1. Onde o piloto roda e quem autoriza. O snapshot contém código do empregador, e rodar numa infraestrutura pessoal não é aceitável sem autorização. As opções são a estação do dev, uma VM da empresa ou a nuvem da empresa. Isso bloqueia os blocos 5 (na forma final) e 8, e a decisão fica com quem responde pelo código, não com o autor.

## Needs a spike

1. Conversa com várias trocas usando `resume`: um follow-up com contradição ("não é isso que vejo, é o tipo B") produz a resposta correta com custo ≤ 50% da primeira pergunta? Se sim, fica o `resume`. Se não, passa a enviar um resumo da conversa com uma nova execução. O spike para depois de rodar 10 casos de contradição do eval set.

## Needs design

1. Canal do suporte (chat web mínimo vs. bot no chat corporativo). O design precisa responder a estes estados do Journey: confirmação imediata e progresso durante minutos de espera, exibição dos ramos e dos cenários de teste, a pergunta de esclarecimento, o fallback com botão de escalonamento, e a conversa retomada no dia seguinte. Depende do RFC 1, porque o local de hospedagem limita quais canais são possíveis.

## Open

1. Formato do eval set: JSONL com `{ id, question, referenceAnswer, expectedBranches?, tags, adversarial: boolean }`. Decide-se ao construir o bloco 2.
2. Idioma da UI e das respostas: `pt-BR`, vindo do perfil.
3. Retenção de transcripts: 90 dias no diretório do perfil.

## Sources

- Roadmap de 7 fases fornecido pelo autor (conversa de 2026-09-30): ordem das fases, pipeline de validação, recomendações de sandbox.
- Documentação da Agent SDK TypeScript, `code.claude.com/docs/en/agent-sdk/typescript`: `tools`, `disallowedTools`, `allowedTools` ("does not restrict Claude to only these tools"), `maxTurns`, `resume`, `outputFormat`/`structured_output`, `settingSources`, `maxBudgetUsd`, `total_cost_usd`, `duration_ms`.
- Skill de explicação funcional existente no codebase-alvo, lida localmente e não citada aqui: fluxo de análise, regras de estilo e os 13 evals de formato.
- Conversa real entre suporte e dev (captura de tela fornecida pelo autor): o caso da resposta sem ramos.
