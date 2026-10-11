import type { PricePoint } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePriceCsv(text: string): PricePoint[] {
  if (typeof text !== "string") throw new TypeError("請提供價格檔文字內容。");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.length > 1 && lines.at(-1) === "") lines.pop();
  if (lines.length < 2 || lines[0] !== "date,close") {
    throw new Error("匯入檔首列須完全符合 date,close。");
  }

  const rows = lines.slice(1);
  if (rows.length > 5000) throw new Error("匯入檔最多可包含 5,000 筆價格。");
  if (rows.length < 100) throw new Error("匯入檔至少須提供 100 筆價格資料。");

  let previousDate = "";
  return rows.map((line, index) => {
    const rowNumber = index + 2;
    const columns = line.split(",");
    if (columns.length !== 2) throw new Error(`第 ${rowNumber} 列須包含日期與收盤價兩欄。`);

    const dateCell = columns[0];
    const closeCell = columns[1];
    if (dateCell === undefined || closeCell === undefined) {
      throw new Error(`第 ${rowNumber} 列須包含日期與收盤價兩欄。`);
    }
    const date = dateCell.trim();
    const closeText = closeCell.trim();
    if (!ISO_DATE.test(date)) throw new Error(`第 ${rowNumber} 列日期須使用 YYYY-MM-DD 格式。`);
    const [yearText, monthText, dayText] = date.split("-");
    if (!yearText || !monthText || !dayText) throw new Error(`第 ${rowNumber} 列不是有效日期。`);
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) throw new Error(`第 ${rowNumber} 列不是有效日期。`);
    if (previousDate && date <= previousDate) {
      throw new Error(`第 ${rowNumber} 列日期重複或未依日期遞增排序。`);
    }

    const close = Number(closeText);
    if (closeText === "" || !Number.isFinite(close) || close <= 0) {
      throw new Error(`第 ${rowNumber} 列收盤價須為大於零的有限數字。`);
    }
    previousDate = date;
    return { date, close };
  });
}
