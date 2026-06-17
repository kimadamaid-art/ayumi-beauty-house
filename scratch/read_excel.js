const XLSX = require('xlsx');

try {
    const workbook = XLSX.readFile('c:/Users/Hilman/Downloads/TikTok_harga_updated.xlsx');
    const sheetName = 'Template';
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log('Total rows:', data.length);
    console.log('Rows 4-15:');
    console.log(data.slice(3, 15));
} catch (err) {
    console.error('Error reading excel:', err);
}
