const defaultCoreSectionIds = ['header', 'services', 'summary', 'supervisors', 'cumulative', 'reports'];

interface ExportReportPdfOptions {
  singleLongPage?: boolean;
}

export async function exportReportPdf(
  reportElement: HTMLElement,
  fileName: string,
  coreSectionIds: readonly string[] = defaultCoreSectionIds,
  options: ExportReportPdfOptions = {},
): Promise<void> {
  const [{ toPng }, { jsPDF }] = await Promise.all([
    import('html-to-image'),
    import('jspdf'),
  ]);
  await document.fonts.ready;
  const clone = reportElement.cloneNode(true) as HTMLElement;
  clone.classList.add('report-export-mode');
  if (options.singleLongPage) clone.classList.add('report-export-long-page');
  clone.querySelectorAll('.no-print').forEach((element) => element.remove());
  const host = document.createElement('div');
  host.className = 'report-export-host';
  if (options.singleLongPage) host.style.width = '1056px';
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const renderImage = async (element: HTMLElement, widthPx = 1100) => {
      element.style.width = `${widthPx}px`;
      element.style.height = 'auto';
      element.style.setProperty('--report-export-scale', '1');
      const dataUrl = await toPng(element, { pixelRatio: 2, cacheBust: true, backgroundColor: '#f4f6fb' });
      const image = new Image();
      image.src = dataUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('تعذر تجهيز صورة التقرير للتصدير.'));
      });
      return { dataUrl, image };
    };
    if (options.singleLongPage) {
      const letterWidthMm = 279.4;
      const sectionClones = [...clone.children].map((section) => section.cloneNode(true) as HTMLElement);
      if (!sectionClones.length) throw new Error('لا توجد أقسام ظاهرة في التقرير لتصديرها.');
      clone.remove();
      const captures = sectionClones.map((section) => {
        const capture = document.createElement('div');
        capture.className = 'report-design-page report-export-mode report-export-long-page report-export-section-capture';
        capture.dir = clone.dir || 'rtl';
        capture.appendChild(section);
        host.appendChild(capture);
        return capture;
      });
      const cssWidthPx = 1056;
      const estimatedHeightMm = captures.reduce((height, capture) => (
        height + Math.max(capture.scrollHeight, capture.getBoundingClientRect().height) * letterWidthMm / cssWidthPx
      ), 0);
      const pageHeightMm = Math.max(letterWidthMm, estimatedHeightMm + captures.length * 0.25);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [letterWidthMm, pageHeightMm],
        compress: true,
      });
      let offsetMm = 0;
      for (const capture of captures) {
        const { dataUrl, image } = await renderImage(capture, cssWidthPx);
        const imageHeightMm = letterWidthMm * image.height / image.width;
        pdf.addImage(dataUrl, 'PNG', 0, offsetMm, letterWidthMm, imageHeightMm);
        offsetMm += imageHeightMm;
        capture.remove();
      }
      pdf.save(fileName);
      return;
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const margin = 9;
    const pageWidth = 210 - margin * 2;
    const pageHeight = 297 - margin * 2;
    const sections = [...clone.children] as HTMLElement[];
    const coreIds = new Set(coreSectionIds);
    const core = document.createElement('div');
    core.className = 'report-design-page report-export-mode report-export-page';
    sections.filter((section) => coreIds.has(section.dataset.sectionId ?? '') || !section.dataset.sectionId)
      .forEach((section) => core.appendChild(section.cloneNode(true)));
    host.appendChild(core);
    const addImagePage = async (element: HTMLElement, forceNewPage: boolean) => {
      const { dataUrl, image } = await renderImage(element);
      if (forceNewPage) pdf.addPage();
      const imageRatio = image.width / image.height;
      const widthImageHeight = pageWidth / imageRatio;
      const scale = Math.min(1, pageHeight / widthImageHeight);
      const imageWidth = pageWidth * scale;
      const imageHeight = widthImageHeight * scale;
      pdf.addImage(dataUrl, 'PNG', (210 - imageWidth) / 2, margin, imageWidth, Math.min(pageHeight, imageHeight));
    };
    await addImagePage(core, false);
    core.remove();
    for (const section of sections.filter((item) => !coreIds.has(item.dataset.sectionId ?? '') && item.dataset.sectionId)) {
      const page = document.createElement('div');
      page.className = 'report-design-page report-export-mode report-export-page';
      page.appendChild(section.cloneNode(true));
      host.appendChild(page);
      await addImagePage(page, true);
      page.remove();
    }
    pdf.save(fileName);
  } finally {
    host.remove();
  }
}
