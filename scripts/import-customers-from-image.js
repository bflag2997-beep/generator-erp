const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const root = path.resolve(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[ـ]/g, "")
    .trim();
}

function phoneKey(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function uniqueRows(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const name = normalize(row.name);
    const phone = phoneKey(row.phone);
    const city = normalize(row.city);
    const address = normalize(row.address);
    if (!name) continue;
    const key = phone ? `${name}|${phone}` : `${name}|${city}|${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...row, name, phone: normalize(row.phone), city, address });
  }
  return output;
}

loadEnv(path.join(root, ".env"));

const customers = uniqueRows([
  { name: "شركة طاقات الفرات - مصطفى كمر", phone: "07730408040", city: "بغداد", address: "الكرادة" },
  { name: "حردان ابو احمد", phone: "", city: "بغداد", address: "الكرادة" },
  { name: "محمد صادق الربيعي", phone: "07700089306", city: "بغداد", address: "بغداد الجديدة" },
  { name: "دكتور احسان هاشم - عيادة ليرزي", phone: "07902610481", city: "بغداد", address: "الطليعية" },
  { name: "ارض العابر", phone: "", city: "البصرة", address: "شارع الوفود" },
  { name: "زيد حلة", phone: "", city: "الحلة", address: "مركز الحلة" },
  { name: "شركة اوفيك", phone: "07502956464", city: "بغداد", address: "كرادة - قرب ساحة التحريات" },
  { name: "مصطفى محسن علي - عيادة مصطفى", phone: "07806867427", city: "بابل", address: "الحلة - قرب مدرسة غزة" },
  { name: "زيد حلة", phone: "", city: "بابل", address: "الحلة" },
  { name: "فندق البحرين - احمد عدنان", phone: "07901489514", city: "بغداد", address: "الكاظمية - شارع الرضا" },
  { name: "علي وعمير", phone: "", city: "بغداد", address: "كمب سارة" },
  { name: "شركة سما كربلاء - محمد مهند", phone: "", city: "كربلاء", address: "قرب مطار كربلاء" },
  { name: "عبد الرسول رعد ظهار", phone: "07800004060", city: "الديوانية", address: "الديوانية" },
  { name: "زيد حلة", phone: "", city: "بابل", address: "الحلة شارع 40" },
  { name: "اثير كريم حسين", phone: "07809008820 / 07718502470", city: "بغداد", address: "جميلة شارع خير الله" },
  { name: "شركة أنظمة الحلول للتجارة العامة والاستثمارات السياحية والاستثمارات العقارية محدودة", phone: "07809164954", city: "بغداد", address: "الدورة شارع أبو طيارة" },
  { name: "شركة مسافات", phone: "", city: "بغداد", address: "الحارثية" },
  { name: "الوليد خالد غالب", phone: "07855555788", city: "ذي قار", address: "الناصرية" },
  { name: "نور عصام الدين صادق", phone: "07901434082", city: "بغداد", address: "اليرموك" },
  { name: "محمد مرزة عبد", phone: "07500341179", city: "بغداد", address: "زونة" },
  { name: "حسين علي عبودي", phone: "07714300626", city: "بغداد", address: "التاجي" },
  { name: "شركة القادرة الكاملة - احمد سالم", phone: "", city: "بغداد", address: "شارع 62" },
  { name: "وليد مخير خلف - شركة النبع الصافي", phone: "07770655122", city: "بغداد", address: "بسماية - حي الوحدة" },
  { name: "محمد متني علوان", phone: "07703166982", city: "ميسان", address: "العمارة" },
  { name: "احمد سلمان جابر العامري", phone: "07725005500", city: "بغداد", address: "الراشدية" },
  { name: "شركة الخير العميم للمقاولات العامة المحدودة - مديرها المفوض تقي رشيد عزيز", phone: "07827777992", city: "واسط", address: "الكوت" },
  { name: "حسين حسين شعيل", phone: "07739990241", city: "ميسان", address: "العمارة قرب مدرسة بطل خبير" },
  { name: "مهندس صالح مهدي محمد - عضو لجنة الاستثمار في ميسان", phone: "07717436961", city: "ميسان", address: "العمارة قرب مدرسة بطل خبير" },
  { name: "علي قيس علي - مجمع 5 كيلو", phone: "07903333008", city: "الأنبار", address: "الرمادي - 5 كيلو" },
  { name: "كريم اسماعيل - كنافة عيبروت", phone: "07725118800", city: "بغداد", address: "كرادة شارع 62" },
  { name: "علي رحيم عامصي", phone: "07737772266", city: "ميسان", address: "العمارة المجمع الكبير" },
  { name: "احمد جبر كامل", phone: "07803337333", city: "الكوت", address: "النعمانية" },
  { name: "شركة كولاب للتجارة", phone: "07707496046", city: "بغداد", address: "أبو غريب" },
  { name: "عبد الله حسن مطر", phone: "07828828871", city: "ذي قار", address: "الرفاعي - طريق أبو الهالش محلات أبو غدير" },
  { name: "فارس الخزاوي - الطاقة المتطورة", phone: "", city: "بغداد", address: "شارع 62" },
  { name: "ارض العابر", phone: "", city: "البصرة", address: "شارع العشار" },
  { name: "مستشفى الحياة الأهلي العام", phone: "07722408373", city: "صلاح الدين", address: "تكريت - شارع 40" },
  { name: "محمود عبد الزهرة احمد حسوني الطائي", phone: "07727080366", city: "بغداد", address: "المدائن التجارة" },
  { name: "سجاد جبار خضير - كافية دخان", phone: "07887501301", city: "ذي قار", address: "الناصرية - الشطرة" },
  { name: "مصطفى مظفر خطوط - محطة مياه الزعفرانية", phone: "07731377404", city: "بغداد", address: "الزعفرانية" },
  { name: "منتظر مجيد علي حسين", phone: "07813989024 / 07805118882", city: "ميسان", address: "قلعة صالح - نهر العز منطقة بيت نصر الله قرب مركز الشرطة" },
  { name: "احمد جميل كاظم - مطعم دجاج شنبك", phone: "07806848866", city: "ذي قار", address: "ناصرية الإدارة المحلية تقاطع البهو" },
  { name: "وسام محمد زوين راشد", phone: "07719434371", city: "بغداد", address: "زعفرانية شارع مستشفى ابن الخطيب" },
  { name: "علاء ابو وشاح", phone: "", city: "بغداد", address: "شارع 62" }
]);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let inserted = 0;
  let skipped = 0;
  try {
    for (const customer of customers) {
      const existing = await pool.query(
        `SELECT id FROM customers
         WHERE lower(trim(name)) = lower(trim($1))
           AND coalesce(phone, '') = coalesce($2, '')
         LIMIT 1`,
        [customer.name, customer.phone]
      );
      if (existing.rowCount) {
        skipped += 1;
        continue;
      }
      await pool.query(
        `INSERT INTO customers (name, phone, address, type, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          customer.name,
          customer.phone,
          customer.address,
          "زبون",
          { ...customer, importedFrom: "customer-image-2026-05-17" }
        ]
      );
      inserted += 1;
    }
    console.log(JSON.stringify({ prepared: customers.length, inserted, skipped }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
