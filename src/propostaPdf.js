const path = require('path');
const PDFDocument = require('pdfkit');
const T = require('./propostaTexto');

const CAPA = path.join(__dirname, 'templates', 'proposta_capa.jpg');
const FUNDO = path.join(__dirname, 'templates', 'proposta_fundo.jpg');
const AZUL = '#2F5597';
const TXT = '#111111';
const W = 595.28, H = 841.89;
const ML = 62, MR = 62; // margens do texto nas paginas de conteudo
const CW = W - ML - MR;

function gerarPdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, autoFirstPage: false,
      info: { Title: `Proposta Comercial - ${d.numero}`, Author: 'Visual Mix' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const horas = Number(d.horas) || 0;
    const valorHora = Number(d.valor_hora) || 0;
    const total = Math.round(horas * valorHora * 100) / 100;
    const extHora = T.valorPorExtenso(valorHora);
    const extTotal = T.valorPorExtenso(total);
    const prazo = T.textoPrazo(d);
    const dataPub = T.dataBR(d.data_publicacao);
    const titulo = String(d.titulo || '').replace(/\s+/g, ' ').trim();
    const horasTxt = Number.isInteger(horas) ? String(horas) : String(horas).replace('.', ',');
    const cliente = d.cliente_nome || '';

    // ------------------------------------------------------------ capa
    doc.addPage();
    doc.image(CAPA, 0, 0, { width: W, height: H });
    doc.roundedRect(30, 640, W - 60, 150, 14).fill('#FFFFFF');
    doc.fillColor(TXT).font('Helvetica-Bold').fontSize(11).text(`PROPOSTA COMERCIAL – ${d.numero}`, 44, 656, { width: 260 });
    doc.font('Helvetica-Bold').fontSize(8.5).text('Projeto: ', 44, 678, { continued: true, width: 270 })
      .font('Helvetica').text(titulo, { width: 270 });
    // linha + data + endereco (lado direito)
    doc.moveTo(330, 733).lineTo(555, 733).lineWidth(0.6).strokeColor('#555555').stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(TXT).text(dataPub, 330, 738, { width: 225, align: 'center' });
    doc.fontSize(8).text('Al. Mamoré, 535 | 19 ° Andar\n06454-910 | Barueri - SP\nFone: 11 2078-0620\nwww.visualmix.com.br', 330, 756, { width: 225, align: 'center', lineGap: 1 });
    doc.font('Helvetica-Bold').fontSize(8.5).text(`A : ${cliente}`, 44, 764, { width: 270 });
    doc.text(`A/C: ${d.contato || ''}`, 44, 777, { width: 270 });

    // ------------------------------------------------------------ paginas de conteudo
    let y = 0;
    const novaPagina = () => {
      doc.addPage();
      doc.image(FUNDO, 0, 0, { width: W, height: H });
      y = 95;
    };
    const garante = (altura) => { if (y + altura > H - 95) novaPagina(); };
    const titulo2 = (txt) => {
      garante(70);
      y += 14;
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(AZUL).text(txt, ML + 8, y, { width: CW });
      y += 30;
    };
    const paragrafo = (txt, opts = {}) => {
      const fs = opts.size || 10.5;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
      const h = doc.heightOfString(txt, { width: CW - (opts.indent || 0), align: 'justify', lineGap: 2 });
      garante(h + 4);
      doc.fillColor(TXT).text(txt, ML + (opts.indent || 0), y, { width: CW - (opts.indent || 0), align: 'justify', lineGap: 2 });
      y += h + (opts.gap == null ? 8 : opts.gap);
    };
    // paragrafo com trechos em negrito: partes = [[texto, negrito?], ...]
    const paragrafoMisto = (partes) => {
      doc.fontSize(10.5);
      const plano = partes.map((p) => p[0]).join('');
      doc.font('Helvetica');
      const h = doc.heightOfString(plano, { width: CW, align: 'justify', lineGap: 2 });
      garante(h + 4);
      partes.forEach((p, i) => {
        doc.font(p[1] ? 'Helvetica-Bold' : 'Helvetica').fillColor(TXT);
        const opt = { continued: i < partes.length - 1, align: 'justify', lineGap: 2, width: CW };
        if (i === 0) doc.text(p[0], ML, y, opt); else doc.text(p[0], opt);
      });
      y += h + 8;
    };
    const marcador = (txt) => {
      doc.font('Helvetica').fontSize(10.5);
      const h = doc.heightOfString(txt, { width: CW - 40, align: 'justify', lineGap: 2 });
      garante(h + 4);
      doc.fillColor(AZUL).font('Helvetica-Bold').text('›', ML + 14, y, { width: 10 });
      doc.fillColor(TXT).font('Helvetica').text(txt, ML + 34, y, { width: CW - 34, align: 'justify', lineGap: 2 });
      y += h + 4;
    };

    novaPagina();
    titulo2('1 – Projeto');
    paragrafo(titulo);

    titulo2('2  - Escopo');
    paragrafoMisto([
      [`Este documento tem por objetivo atender as necessidades do cliente ${cliente} no que tange à ${titulo}, conforme solicitação efetuada através do chamado `, false],
      [String(d.numero), true], ['.', false],
    ]);

    titulo2('3  - Premissas');
    paragrafo('Para devido atendimento das tarefas envolvidas no atendimento da solicitação efetuada pelo cliente, ficam estabelecidas as premissas abaixo:');
    marcador('O cliente deverá disponibilizar um recurso para acompanhar as tarefas executadas pelo profissional Visual Mix.');
    marcador('O cliente deverá disponibilizar o ambiente de homologação para validação');
    marcador('As tarefas deste projeto serão executadas de forma remota.');
    marcador(`O escopo deste projeto é baseado no documento DEF001c${d.numero}v01.pdf, previamente aprovado pelo ${cliente}.`);
    marcador('Eventuais alterações de escopo serão tratadas como novas solicitações, após a respectiva aprovação de especificação e proposta comercial.');
    marcador(`O valor/hora praticado pela Visual Mix é de R$ ${T.moedaBR(valorHora)} (${extHora.completo}), valor este corrigido anualmente pelo IGP-M (Índice Geral de Preços – Mercado), calculado pelo Instituto Brasileiro de Economia da Fundação Getúlio Vargas (FGV IBRE).`);

    titulo2('4  – Estimativa de esforço');
    paragrafo(`O esforço necessário para execução da implantação, testes e acompanhamento da virada em produção, serviços estes a serem realizados de forma remota, é estimado em ${horasTxt} horas.`);

    novaPagina();
    titulo2('5  - Custos de projeto');
    paragrafo(`Em termos de custos do projeto coberto no escopo, assumiremos um pacote no valor de ${horasTxt} horas, ou seja, em caso de eventual aumento das horas consumidas, desde que não haja mudança no escopo, manteremos o valor aqui definido.`);
    paragrafoMisto([
      [`Nossos custos são calculados de acordo com o nível e função dos profissionais envolvidos no projeto, assim sendo, estimamos o valor total do pacote de ${horasTxt} horas deste projeto em `, false],
      [`R$ ${T.moedaBR(total)}`, true], [` (${extTotal.completo}).`, false],
    ]);

    titulo2('6  – Forma de pagamento');
    paragrafo(T.textoPagamento(d.parcelas, d.dias_primeira, d.dias_intervalo), { size: 9.5 });

    titulo2('7  - Prazo de validade');
    const apTxt = prazo.ap ? `${String(prazo.ap.dia).padStart(2, '0')}/${String(prazo.ap.mes).padStart(2, '0')}` : '__/__';
    paragrafoMisto([
      [`O projeto sendo aprovado até o dia ${apTxt} a programação para início das atividades no `, false],
      [`ambiente de homologação do cliente é no dia ${prazo.inicio}`, true], ['.', false],
    ]);
    paragrafo('Após a conclusão do desenvolvimento, serão planejadas e executadas as etapas de instalação, homologação e validação da solução em conjunto com a equipe de implantação e gerente de Projetos da Visual Mix e a equipe do cliente, conforme cronograma a ser definido entre as partes.');
    String(d.texto_extra || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((t) => paragrafo(t));

    // ---- confirmacao de pedido
    novaPagina();
    titulo2('8 - Confirmação de Pedido');
    y += 6;
    const linha = (rotulo, x, yy, larg) => {
      doc.font('Helvetica').fontSize(10).fillColor(TXT).text(rotulo, x, yy, { lineBreak: false });
      const lw = doc.widthOfString(rotulo) + 6;
      doc.moveTo(x + lw, yy + 11).lineTo(x + larg, yy + 11).lineWidth(0.6).strokeColor('#333333').stroke();
    };
    const E = ML - 10, R = W - 56, MEIO = 330;
    const rows = [
      [['Razão Social:', E, R - E]], [['Nome Fantasia:', E, R - E]], [['Endereço:', E, R - E]],
      [['Bairro:', E, MEIO - 20 - E], ['CEP:', MEIO, R - MEIO]],
      [['Cidade:', E, MEIO - 20 - E], ['UF:', MEIO, R - MEIO]],
      [['CNPJ:', E, MEIO - 20 - E], ['I.E:', MEIO, R - MEIO]],
      [['Contato:', E, MEIO - 20 - E], ['E-mail:', MEIO, R - MEIO]],
      [['Telefone:', E, MEIO - 20 - E], ['Fax:', MEIO, R - MEIO]],
      [['Representante Legal:', E, R - E]],
      [['Assinatura', E, MEIO - 20 - E], ['Data:', MEIO, R - MEIO]],
      [['Representante Comercial:', E, R - E]],
    ];
    rows.forEach((r) => { r.forEach((c) => linha(c[0], c[1], y, c[2])); y += 30; });
    doc.font('Helvetica').fontSize(10).fillColor(TXT);
    linha('Data da Visita:', E, y, 200);
    doc.text('Data da Proposta:', 270, y, { lineBreak: false });
    doc.text(dataPub, 400, y, { lineBreak: false });
    doc.moveTo(395, y + 11).lineTo(R, y + 11).lineWidth(0.6).strokeColor('#333333').stroke();

    // ---- rodape (titulo, data, "n de N") nas paginas de conteudo
    const total_pag = doc.bufferedPageRange().count;
    for (let i = 1; i < total_pag; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#222222')
        .text(titulo, 40, H - 58, { width: W - 80, align: 'center', lineBreak: false, ellipsis: true });
      doc.text(dataPub, 40, H - 47, { width: W - 80, align: 'center', lineBreak: false });
      doc.text(`${i + 1} de ${total_pag}`, W - 240, H - 47, { width: 80, align: "right", lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { gerarPdf };
