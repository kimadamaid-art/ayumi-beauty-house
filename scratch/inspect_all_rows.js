const XLSX = require('xlsx');

try {
    const workbook = XLSX.readFile('Harga Item Ayumi (1).xlsx');
    const sheetName = 'Sheet1';
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log('Total items in Ayumi Excel:', data.length);
    data.forEach((row, idx) => {
        console.log(`${idx + 1}. [${row['Service/Retail']}] ${row['Item Name']} (${row['Item Category'] || 'No Category'}) - Price: ${row['Item Price']}`);
    });
} catch (err) {
    console.error('Error reading excel:', err);
}
