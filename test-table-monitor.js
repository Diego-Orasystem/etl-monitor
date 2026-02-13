// Script de prueba para el monitoreo de tablas
const mysql = require('mysql2/promise');
const { DB_HOST = '10.4.0.190', DB_PORT = '3306', DB_USER = 'fits', DB_PASS = 'fits.2024', DB_JOINED_NAME = 'LEK-JOINED-DEV' } = process.env;

async function testTableMonitor() {
    let connection = null;
    
    try {
        console.log('🧪 Iniciando prueba del monitoreo de tablas...\n');
        
        // Conectar a la base de datos
        connection = await mysql.createConnection({
            host: DB_HOST,
            port: Number(DB_PORT),
            user: DB_USER,
            password: DB_PASS,
            database: DB_JOINED_NAME,
            connectTimeout: 10000
        });
        
        console.log('✅ Conectado a la base de datos');
        
        // Obtener lista actual de tablas
        const [tables] = await connection.execute(
            `SELECT TABLE_NAME 
             FROM information_schema.TABLES 
             WHERE TABLE_SCHEMA = ? 
             ORDER BY TABLE_NAME`,
            [DB_JOINED_NAME]
        );
        
        console.log(`📊 Tablas actuales (${tables.length}):`);
        tables.forEach(t => console.log(`   - ${t.TABLE_NAME}`));
        
        // Crear una tabla de prueba
        const testTableName = `TEST_MONITOR_${Date.now()}`;
        console.log(`\n🔨 Creando tabla de prueba: ${testTableName}`);
        
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS \`${testTableName}\` (
                id INT PRIMARY KEY AUTO_INCREMENT,
                test_data VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log(`✅ Tabla ${testTableName} creada`);
        console.log('⏳ Esperando 2 segundos para que el monitoreo detecte el cambio...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verificar que la tabla existe
        const [newTables] = await connection.execute(
            `SELECT TABLE_NAME 
             FROM information_schema.TABLES 
             WHERE TABLE_SCHEMA = ? 
             ORDER BY TABLE_NAME`,
            [DB_JOINED_NAME]
        );
        
        console.log(`📊 Tablas después de crear (${newTables.length}):`);
        const found = newTables.find(t => t.TABLE_NAME === testTableName);
        if (found) {
            console.log(`   ✅ ${testTableName} encontrada`);
        } else {
            console.log(`   ❌ ${testTableName} NO encontrada`);
        }
        
        // Eliminar la tabla de prueba
        console.log(`\n🗑️  Eliminando tabla de prueba: ${testTableName}`);
        await connection.execute(`DROP TABLE IF EXISTS \`${testTableName}\``);
        console.log(`✅ Tabla ${testTableName} eliminada`);
        console.log('⏳ Esperando 2 segundos para que el monitoreo detecte el cambio...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verificar que la tabla fue eliminada
        const [finalTables] = await connection.execute(
            `SELECT TABLE_NAME 
             FROM information_schema.TABLES 
             WHERE TABLE_SCHEMA = ? 
             ORDER BY TABLE_NAME`,
            [DB_JOINED_NAME]
        );
        
        console.log(`📊 Tablas finales (${finalTables.length}):`);
        const stillExists = finalTables.find(t => t.TABLE_NAME === testTableName);
        if (!stillExists) {
            console.log(`   ✅ ${testTableName} eliminada correctamente`);
        } else {
            console.log(`   ❌ ${testTableName} todavía existe`);
        }
        
        console.log('\n✅ Prueba completada. Revisa la interfaz web para ver las notificaciones.');
        
    } catch (error) {
        console.error('❌ Error durante la prueba:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

testTableMonitor();



