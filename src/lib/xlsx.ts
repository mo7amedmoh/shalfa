export type XlsxModule = typeof import('xlsx');

let xlsxModule: Promise<XlsxModule> | null = null;

export function loadXlsx(): Promise<XlsxModule> {
  xlsxModule ??= import('xlsx');
  return xlsxModule;
}
