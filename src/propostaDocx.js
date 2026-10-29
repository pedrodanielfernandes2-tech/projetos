const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const T = require('./propostaTexto');

const MODELO = path.join(__dirname, 'templates', 'proposta_modelo.docx');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Troca o texto de todos os "runs" (<w:t>) cujo conteudo e EXATAMENTE `de`.
// O valor novo entra como marcador (@@Kn@@) e so vira texto no fim, pra um valor
// recem-colocado (ex.: horas = "30") nunca ser trocado de novo por outra regra.
let _tokens = null;
function trocarRun(xml, de, para, { min = 1 } = {}) {
  const re = new RegExp(`(<w:t(?: [^>]*)?>)${de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(</w:t>)`, 'g');
  let n = 0;
  const out = xml.replace(re, (m, a, b) => { n++; const k = `@@K${_tokens.length}@@`; _tokens.push(esc(para)); return `${a}${k}${b}`; });
  if (n < min) throw new Error(`modelo de proposta mudou: trecho "${de}" nao encontrado`);
  return out;
}

// Dados no formato do banco (tabela chamados_propostas) -> Buffer .docx
async function gerarDocx(d) {
  _tokens = [];
  const zip = await JSZip.loadAsync(fs.readFileSync(MODELO));
  let doc = await zip.file('word/document.xml').async('string');
  let rodape = await zip.file('word/footer1.xml').async('string');

  const horas = Number(d.horas) || 0;
  const valorHora = Number(d.valor_hora) || 0;
  const total = Math.round(horas * valorHora * 100) / 100;
  const extHora = T.valorPorExtenso(valorHora);
  const extTotal = T.valorPorExtenso(total);
  const prazo = T.textoPrazo(d);
  const dataPub = T.dataBR(d.data_publicacao);
  const titulo = String(d.titulo || '').replace(/\s+/g, ' ').trim();
  const horasTxt = String(Number.isInteger(horas) ? horas : String(horas).replace('.', ','));

  // ---- cabecalho / capa
  doc = trocarRun(doc, '23/10/2026', dataPub);
  doc = trocarRun(doc, '30336', String(d.numero));
  doc = trocarRun(doc, 'Boa Supermercados', d.cliente_nome || '');
  doc = trocarRun(doc, 'Fabio', d.contato || '');
  doc = trocarRun(doc, 'Salvatore', '');
  doc = trocarRun(doc, 'Melhoria na Campanha de Selos – Parâmetro de Valor Mínimo para Selos em Dobro e Acúmulo com Cartão +Amigo', titulo);

  // ---- premissas
  // (o nome do documento de escopo "DEF001c<numero>v01.pdf" usa o numero do chamado, ja trocado acima)
  doc = doc.replace(/<w:hyperlink [^>]*>/g, '').replace(/<\/w:hyperlink>/g, '').replace(/<w:rStyle w:val="Hyperlink"\/>/g, '');
  doc = trocarRun(doc, '162,94', T.moedaBR(valorHora));
  doc = trocarRun(doc, 'cento e sessenta e', extHora.inicio);
  doc = trocarRun(doc, 'dois reais', extHora.final);

  // ---- esforco e custos
  doc = trocarRun(doc, '72', horasTxt, { min: 3 });
  doc = trocarRun(doc, '11.731,68', T.moedaBR(total));
  doc = trocarRun(doc, 'onze mil setecentos e trinta e dois', extTotal.inicio);
  doc = trocarRun(doc, 'reais', extTotal.final);

  // ---- pagamento
  doc = trocarRun(doc,
    'Em prol da parceria entre as empresas, a Visual Mix disponibiliza o parcelamento do total do projeto em 2 vezes sem juros, sendo a primeira parcela em 15 dias após o aceite da proposta e respectivo faturamento e a segunda em 30 dias.',
    T.textoPagamento(d.parcelas, d.dias_primeira, d.dias_intervalo));

  // ---- prazo: "aprovado ate o dia 30/10 ... inicio no dia 23 de novembro de 2026"
  doc = trocarRun(doc, '30', prazo.ap ? String(prazo.ap.dia).padStart(2, '0') : '__');
  doc = trocarRun(doc, '10', prazo.ap ? String(prazo.ap.mes).padStart(2, '0') : '__');
  doc = trocarRun(doc, '23', prazo.ini ? String(prazo.ini.dia) : '__');
  doc = trocarRun(doc, 'novembro', prazo.ini ? T.MESES[prazo.ini.mes - 1] : '______');
  doc = trocarRun(doc, ' de 2026', prazo.ini ? ` de ${prazo.ini.ano}` : ' de ____');

  // ---- texto adicional (livre): paragrafos extras depois do ultimo paragrafo de prazo
  const extra = String(d.texto_extra || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (extra.length) {
    const re = /<w:p [^>]*>(?:(?!<w:p[ >])[\s\S])*?<\/w:p>/g;
    let alvo = null, m;
    while ((m = re.exec(doc))) { if (m[0].includes('Após a conclusão do desenvolvimento')) { alvo = m[0]; break; } }
    if (!alvo) throw new Error('modelo de proposta mudou: paragrafo de conclusao nao encontrado');
    const semQuebraBase = alvo.replace(/<w:r(?: [^>]*)?>(?:(?!<w:r[ >])[\s\S])*?<w:br w:type="page"\/><\/w:r>/, '');
    const clonar = (texto) => {
      let usado = false;
      return semQuebraBase.replace(/(<w:t(?: [^>]*)?>)[^<]*(<\/w:t>)/g, (x, a, b) => {
        if (usado) return `${a}${b}`;
        usado = true;
        return `<w:t xml:space="preserve">${esc(texto)}</w:t>`;
      });
    };
    // o paragrafo original termina com quebra de pagina: tira dele, coloca os extras e
    // recoloca a quebra num paragrafo proprio no fim
    const quebra = /<w:r(?: [^>]*)?>(?:(?!<w:r[ >])[\s\S])*?<w:br w:type="page"\/><\/w:r>/;
    const semQuebra = alvo.replace(quebra, '');
    const extras = extra.map((t) => clonar(t).replace(quebra, '')).join('');
    doc = doc.replace(alvo, semQuebra + extras + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }

  // ---- rodape: titulo + data
  rodape = trocarRun(rodape, 'Melhoria na Campanha de Selos – Parâmetro de Valor Mínimo para Selos em Dobro e Acúmulo com Cartão +Amigo', titulo);
  rodape = trocarRun(rodape, '23/10/2026', dataPub);

  const volta = (x) => x.replace(/@@K(\d+)@@/g, (m, i) => _tokens[Number(i)]);
  doc = volta(doc); rodape = volta(rodape);
  zip.file('word/document.xml', doc);
  // Os campos da capa/rodape sao "controles de conteudo" ligados as propriedades do
  // arquivo (titulo, assunto, categoria, empresa, data de publicacao). O Word relê essas
  // propriedades ao abrir, entao elas tambem precisam ser atualizadas.
  const trocaTag = async (arq, tag, valor) => {
    const f = zip.file(arq); if (!f) return;
    const x = await f.async('string');
    const re = new RegExp(`(<${tag}(?: [^>]*)?>)[^<]*(</${tag}>)`);
    if (re.test(x)) zip.file(arq, x.replace(re, (m, a, b) => `${a}${esc(valor)}${b}`));
  };
  await trocaTag('docProps/core.xml', 'dc:title', String(d.numero));
  await trocaTag('docProps/core.xml', 'dc:subject', titulo);
  await trocaTag('docProps/core.xml', 'dc:description', String(d.numero));
  await trocaTag('docProps/core.xml', 'cp:category', d.contato || '');
  await trocaTag('docProps/app.xml', 'Company', d.cliente_nome || '');
  await trocaTag('customXml/item1.xml', 'PublishDate', `${String(d.data_publicacao || '').slice(0, 10) || '2026-01-01'}T00:00:00`);
  zip.file('word/footer1.xml', rodape);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { gerarDocx };
