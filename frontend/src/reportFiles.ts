import { unzip } from "fflate";

export const MAX_REPORT_FILE_SIZE = 50 * 1024 * 1024;

function isPdf(name: string) {
  return name.toLowerCase().endsWith(".pdf");
}

function isZip(name: string) {
  return name.toLowerCase().endsWith(".zip");
}

function sizeError(name: string) {
  return `${name}: размер превышает 50 МБ`;
}

async function extractPdfFiles(archive: File): Promise<File[]> {
  const bytes = new Uint8Array(await archive.arrayBuffer());

  return new Promise((resolve, reject) => {
    let extractedSize = 0;
    let archiveError = "";

    unzip(bytes, {
      filter(entry) {
        if (entry.name.endsWith("/") || !isPdf(entry.name)) return false;
        if (entry.originalSize > MAX_REPORT_FILE_SIZE) {
          archiveError = sizeError(entry.name);
          return false;
        }
        extractedSize += entry.originalSize;
        if (extractedSize > MAX_REPORT_FILE_SIZE) {
          archiveError = `${archive.name}: PDF внутри архива занимают больше 50 МБ`;
          return false;
        }
        return true;
      },
    }, (error, entries) => {
      if (error) {
        reject(new Error(`${archive.name}: не удалось распаковать ZIP`));
        return;
      }
      if (archiveError) {
        reject(new Error(archiveError));
        return;
      }

      const files = Object.entries(entries).map(([path, data]) => {
        const name = path.split("/").pop() || path;
        return new File([new Uint8Array(data)], name, { type: "application/pdf" });
      });
      if (!files.length) {
        reject(new Error(`${archive.name}: в архиве нет PDF-файлов`));
        return;
      }
      resolve(files);
    });
  });
}

export async function collectReportFiles(files: File[]): Promise<File[]> {
  const supported = files.filter((file) => isPdf(file.name) || isZip(file.name));
  if (!supported.length) {
    throw new Error("Выберите кредитный отчет в формате PDF или ZIP с PDF-файлами");
  }

  const reports: File[] = [];
  for (const file of supported) {
    if (file.size > MAX_REPORT_FILE_SIZE) throw new Error(sizeError(file.name));
    if (isPdf(file.name)) reports.push(file);
    else reports.push(...await extractPdfFiles(file));
  }
  return reports;
}
