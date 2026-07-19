const { Pool } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:yUAkumMqejYdHBijJxzmmRdmxrEKEiog@hayabusa.proxy.rlwy.net:42335/railway';
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function classifyCategory(title) {
  const t = (title || '').toLowerCase();
  
  if (t.includes('phone') || t.includes('mobile') || t.includes('smartphone') || t.includes('iphone') || t.includes('galaxy') || t.includes('pixel') || t.includes('oneplus') || t.includes('realme') || t.includes('redmi') || t.includes('poco') || t.includes('motorola')) {
    return 'Mobiles';
  }
  if (t.includes('laptop') || t.includes('notebook') || t.includes('macbook') || t.includes('chromebook') || t.includes('computer')) {
    return 'Laptops';
  }
  if (t.includes('t-shirt') || t.includes('shirt') || t.includes('jeans') || t.includes('jacket') || t.includes('apparel') || t.includes('clothing') || t.includes('hoodie') || t.includes('shoe') || t.includes('sneaker') || t.includes('sandal') || t.includes('footwear') || t.includes('slippers') || t.includes('belt') || t.includes('wallet') || t.includes('watch') || t.includes('bag')) {
    return 'Fashion';
  }
  if (t.includes('refrigerator') || t.includes('fridge') || t.includes('washing machine') || t.includes('washer') || t.includes('dryer') || t.includes('air conditioner') || t.includes('ac') || t.includes('geyser') || t.includes('heater') || t.includes('vacuum')) {
    return 'Home Appliances';
  }
  if (t.includes('shampoo') || t.includes('cream') || t.includes('serum') || t.includes('makeup') || t.includes('soap') || t.includes('perfume') || t.includes('grooming') || t.includes('face wash') || t.includes('moisturizer') || t.includes('cosmetics') || t.includes('beauty') || t.includes('hair')) {
    return 'Beauty & Care';
  }
  if (t.includes('chair') || t.includes('desk') || t.includes('sofa') || t.includes('table') || t.includes('bed') || t.includes('wardrobe') || t.includes('furniture') || t.includes('cabinet')) {
    return 'Furniture';
  }
  if (t.includes('mixer') || t.includes('grinder') || t.includes('blender') || t.includes('cooker') || t.includes('kettle') || t.includes('fryer') || t.includes('purifier') || t.includes('induction') || t.includes('cookware') || t.includes('kitchen') || t.includes('oven')) {
    return 'Kitchen';
  }
  
  return 'Electronics'; // Default category
}

async function run() {
  const client = await pool.connect();
  try {
    console.log("Fetching all products...");
    const res = await client.query("SELECT id, title, category FROM products");
    console.log(`Found ${res.rows.length} products. Migrating categories...`);
    
    let count = 0;
    for (const row of res.rows) {
      const correctCategory = classifyCategory(row.title);
      if (row.category !== correctCategory) {
        await client.query("UPDATE products SET category = $1 WHERE id = $2", [correctCategory, row.id]);
        count++;
      }
    }
    console.log(`Successfully migrated ${count} products to correct categories!`);
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
