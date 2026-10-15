# Importador de listas: contrato e verificação

`backend.importers.extract_candidates(content, filename, sheet=None, columns=None)` retorna `items` (`[{"text": ...}]`), `sheets` (nomes das abas XLSX), `columns` (`[{"index": ..., "label": ...}]`) e `warnings`. A função só extrai candidatos; a revisão e criação da lista ficam com a API e a interface.

DOCX percorre parágrafos e células de tabelas na ordem do documento. XLSX abre em modo somente leitura, com `data_only=True` e `keep_links=False`: fórmulas sem resultado armazenado ficam vazias. A primeira aba e a primeira coluna são o padrão. Os índices de coluna são **baseados em zero** tanto na entrada `columns` quanto na saída `columns[].index`. Quando várias colunas são escolhidas, seus valores não vazios são unidos por ` — ` na ordem das colunas. A primeira linha também aparece como candidato; o usuário deve remover cabeçalhos durante a revisão. PDF textual é separado por linhas não vazias; PDF sem texto extraível pede conversão com OCR.

Validações: entrada de até 10 MB, Office ZIP expandido de até 50 MB e 2000 entradas, até 100 páginas PDF, 1000 candidatos, 256 colunas e 100 mil linhas XLSX. Extensões antigas `.doc`/`.xls` pedem conversão. Arquivos com extensão incompatível, Office ZIP corrompido, XML com DTD/entidades e PDFs protegidos ou digitalizados geram mensagens em português. O importador não executa macros nem fórmulas.

Verificação: `python -m unittest discover -s tests -p test_importers.py -v` executou 13 testes com arquivos gerados em memória. Cobrem DOCX Unicode e ordem, XLSX com várias abas/colunas e fórmulas sem cache, PDF textual e sem texto, limites e erros de formato.
