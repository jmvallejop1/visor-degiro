// Variables globales
let allTransactions = [];
let filteredTransactions = [];
let depositsChart = null;

// Elementos del DOM
const csvFileInput = document.getElementById('csvFile');
const fileNameSpan = document.getElementById('fileName');
const dashboard = document.getElementById('dashboard');
const searchProduct = document.getElementById('searchProduct');
const resetTransactionsBtn = document.getElementById('resetTransactionsBtn');
// Activar colapsado de secciones (flechas ▾/▸)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const sel = btn.getAttribute('data-target');
    if (!sel) return;
    const body = document.querySelector(sel);
    if (!body) return;
    
    const isExpanded = btn.getAttribute('aria-expanded') !== 'false';
    const willExpand = !isExpanded;
    
    // Toggle con animación suave
    if (willExpand) {
        body.style.display = '';
        // Forzar reflow
        body.offsetHeight;
        body.style.opacity = '1';
        body.style.maxHeight = '10000px';
    } else {
        body.style.opacity = '0';
        body.style.maxHeight = '0';
        setTimeout(() => {
            body.style.display = 'none';
        }, 300);
    }
    
    btn.setAttribute('aria-expanded', String(willExpand));
    btn.textContent = willExpand ? '▾' : '▸';
    btn.title = willExpand ? 'Ocultar sección' : 'Mostrar sección';
});

// Event Listeners
csvFileInput.addEventListener('change', handleFileSelect);
if (searchProduct) {
    searchProduct.addEventListener('input', filterPortfolio);
}

// Función para cargar datos desde localStorage
function loadFromStorage() {
    const stored = localStorage.getItem('degiro.transactions.v1');
    if (stored) {
        try {
            allTransactions = JSON.parse(stored);
            filteredTransactions = [...allTransactions];
            displayDashboard();
            checkStorageButtonVisibility();
        } catch (e) {
            console.error('Error loading from localStorage:', e);
        }
    }
}

// Cargar datos al iniciar la página
window.addEventListener('DOMContentLoaded', loadFromStorage);

// Mostrar/ocultar botón de reset dependiendo de si hay transacciones en localStorage
function checkStorageButtonVisibility() {
    try {
        const has = !!localStorage.getItem('degiro.transactions.v1');
        if (resetTransactionsBtn) resetTransactionsBtn.style.display = has ? '' : 'none';
    } catch (e) {
        // Si localStorage no está disponible, ocultar el botón
        if (resetTransactionsBtn) resetTransactionsBtn.style.display = 'none';
    }
}

// Función para resetear transacciones guardadas (con confirmación)
function resetTransactions() {
    if (!confirm('¿Estás seguro de que deseas eliminar las transacciones guardadas en localStorage? Esta acción no se puede deshacer.')) return;

    try {
        localStorage.removeItem('degiro.transactions.v1');
    } catch (e) {
        console.error('Error removing from localStorage:', e);
    }

    // Limpiar variables y UI
    allTransactions = [];
    filteredTransactions = [];
    if (depositsChart) {
        try { depositsChart.destroy(); } catch (_) {}
        depositsChart = null;
    }
    if (fileNameSpan) fileNameSpan.textContent = '';
    if (dashboard) dashboard.style.display = 'none';

    // Reconstruir portfolio vacío
    const tbody = document.getElementById('portfolioBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 2rem;">No hay posiciones activas</td></tr>';

    checkStorageButtonVisibility();
}

// Listener del botón
if (resetTransactionsBtn) {
    resetTransactionsBtn.addEventListener('click', resetTransactions);
}

// Función para manejar la selección del archivo
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    fileNameSpan.textContent = `Archivo cargado: ${file.name}`;

    const fileExtension = file.name.split('.').pop().toLowerCase();

    if (fileExtension === 'csv') {
        // Leer archivo CSV
        const reader = new FileReader();
        reader.onload = function(e) {
            const content = e.target.result;
            parseCSV(content);
        };
        reader.readAsText(file, 'UTF-8');
    } else if (fileExtension === 'xls' || fileExtension === 'xlsx') {
        // Leer archivo Excel
        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            parseExcel(data);
        };
        reader.readAsArrayBuffer(file);
    } else {
        alert('Por favor, selecciona un archivo CSV, XLS o XLSX válido.');
    }
}

// Función para parsear archivos Excel
function parseExcel(data) {
    try {
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convertir la hoja a JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        console.log(jsonData);
        
        allTransactions = [];

        // Saltar la primera fila (encabezados)
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;

            // Convert possible Excel serial dates/times to readable strings
            let rawFecha = row[0];
            let rawHora = row[1];
            let rawFechaValor = row[2];

            // If fecha is numeric, convert Excel serial to Date then to dd-mm-yyyy
            let fechaStr = '';
            if (rawFecha !== undefined && rawFecha !== null && rawFecha !== '') {
                if (typeof rawFecha === 'number' || (!isNaN(Number(rawFecha)) && String(rawFecha).trim() !== '')) {
                    const d = excelSerialToJSDate(rawFecha);
                    fechaStr = d ? formatDateForDisplay(d) : String(rawFecha).trim();
                } else {
                    fechaStr = String(rawFecha).trim();
                }
            }

            // Hora: could be fraction (0.70625) or number representing datetime or a string
            let horaStr = '';
            if (rawHora !== undefined && rawHora !== null && rawHora !== '') {
                // If hora is numeric or a numeric-looking string
                if (typeof rawHora === 'number' || (!isNaN(Number(rawHora)) && String(rawHora).trim() !== '')) {
                    horaStr = formatTimeFromSerial(Number(rawHora));
                } else {
                    horaStr = String(rawHora).trim();
                }
            }

            // fechaValor similar handling
            let fechaValorStr = '';
            if (rawFechaValor !== undefined && rawFechaValor !== null && rawFechaValor !== '') {
                if (typeof rawFechaValor === 'number' || (!isNaN(Number(rawFechaValor)) && String(rawFechaValor).trim() !== '')) {
                    const d = excelSerialToJSDate(rawFechaValor);
                    fechaValorStr = d ? formatDateForDisplay(d) : String(rawFechaValor).trim();
                } else {
                    fechaValorStr = String(rawFechaValor).trim();
                }
            }

            const transaction = {
                fecha: fechaStr,
                hora: horaStr,
                fechaValor: fechaValorStr,
                producto: row[3] ? String(row[3]).trim() : '',
                isin: row[4] ? String(row[4]).trim() : '',
                descripcion: row[5] ? String(row[5]).trim() : '',
                tipo: row[6] ? String(row[6]).trim() : '',
                moneda1: row[7] ? String(row[7]).trim() : '',
                variacion: parseAmount(row[8]),
                moneda2: row[9] ? String(row[9]).trim() : '',
                saldo: parseAmount(row[10]),
                idOrden: row[11] ? String(row[11]).trim() : ''
            };

            allTransactions.push(transaction);
        }

        // Persistimos para que la pestaña de dividendos pueda reutilizar
        try { localStorage.setItem('degiro.transactions.v1', JSON.stringify(allTransactions)); } catch (_) {}
        filteredTransactions = [...allTransactions];
        displayDashboard();
    checkStorageButtonVisibility();
    } catch (error) {
        console.error('Error al procesar el archivo Excel:', error);
        alert('Error al procesar el archivo Excel. Por favor, verifica que el formato sea correcto.');
    }
}

// Función para parsear el CSV
function parseCSV(content) {
    const lines = content.split('\n');
    const headers = lines[0].split(',');
    
    allTransactions = [];

    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;

        // Usar una expresión regular para manejar comas dentro de comillas
        const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
        
        if (!values || values.length < 8) continue;

        const transaction = {
            fecha: values[0]?.replace(/"/g, '').trim() || '',
            hora: values[1]?.replace(/"/g, '').trim() || '',
            fechaValor: values[2]?.replace(/"/g, '').trim() || '',
            producto: values[3]?.replace(/"/g, '').trim() || '',
            isin: values[4]?.replace(/"/g, '').trim() || '',
            descripcion: values[5]?.replace(/"/g, '').trim() || '',
            tipo: values[6]?.replace(/"/g, '').trim() || '',
            moneda1: values[7]?.replace(/"/g, '').trim() || '',
            variacion: parseAmount(values[8]?.replace(/"/g, '').trim() || '0'),
            moneda2: values[9]?.replace(/"/g, '').trim() || '',
            saldo: parseAmount(values[10]?.replace(/"/g, '').trim() || '0'),
            idOrden: values[11]?.replace(/"/g, '').trim() || ''
        };

        allTransactions.push(transaction);
    }

    // Persistimos para que la pestaña de dividendos pueda reutilizar
    try { localStorage.setItem('degiro.transactions.v1', JSON.stringify(allTransactions)); } catch (_) {}
    filteredTransactions = [...allTransactions];
    displayDashboard();
    checkStorageButtonVisibility();
}

// Función para convertir strings de cantidades a números
function parseAmount(str) {
    if (str === null || str === undefined || str === '') return 0;
    
    if (typeof str === 'number') return str;
    
    str = String(str).trim();
    
    return parseFloat(str.replace(/\./g, '').replace(',', '.').replace(/"/g, '')) || 0;
}

function formatAmount(amount) {
    return new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function parseDateTime(fecha, hora) {
    if (!fecha) return new Date(0);

    const parts = fecha.split('-');
    if (parts.length === 3) {
        const [dd, mm, yyyy] = parts;
        const [hours = '0', minutes = '0', seconds = '0'] = (hora || '').split(':');
        return new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hours),
            Number(minutes),
            Number(seconds)
        );
    }

    return new Date(fecha);
}

// Helpers to handle Excel serial dates and times
function excelSerialToJSDate(serial) {
    // Accept Date objects directly
    if (serial instanceof Date) return serial;
    const num = Number(serial);
    if (isNaN(num)) return null;

    // Excel has a known bug with 1900 being treated as a leap year.
    // Use the common conversion: days offset from 1970-01-01 by 25569 (Excel epoch)
    // For serials >= 60, subtract an extra day to account for the fake 1900-02-29
    const days = Math.floor(num);
    const fractional = num - days;
    const offsetDays = (days > 60) ? days - 25569 : days - 25568;
    const ms = (offsetDays + fractional) * 86400 * 1000;
    return new Date(ms);
}

function pad(n) { return n.toString().padStart(2, '0'); }

function formatDateForDisplay(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function formatTimeFromSerial(value) {
    // value can be a number fraction of day (e.g., 0.70625) or a Date
    if (value instanceof Date) {
        return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    }
    const num = Number(value);
    if (isNaN(num)) return String(value || '').trim();

    // If >= 1 treat as full Excel serial date/time
    if (num >= 1) {
        const dt = excelSerialToJSDate(num);
        return formatTimeFromSerial(dt);
    }

    // Fraction of a day -> convert to seconds
    const totalSeconds = Math.round(num * 24 * 3600);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Función principal para mostrar el dashboard
function displayDashboard() {
    dashboard.style.display = 'block';
    displayDepositsChart();
    buildAndRenderPortfolio();
}

// Gráfica de depósitos en el tiempo (acumulado)
function displayDepositsChart() {
    const deposits = allTransactions.filter(t => {
        const d = (t.descripcion || '').toLowerCase();
        return d.includes('deposit') || d.includes('depósito') || d.includes('deposito');
    });

    if (deposits.length === 0) return;

    deposits.sort((a, b) => parseDateTime(a.fecha, a.hora) - parseDateTime(b.fecha, b.hora));

    let cumulative = 0;
    const labels = [];
    const data = [];
    const perDeposit = [];
    deposits.forEach(d => {
        cumulative += Number(d.variacion) || 0;
        labels.push(d.fecha);
        data.push(cumulative);
        perDeposit.push(Number(d.variacion) || 0);
    });

    const ctx = document.getElementById('depositsChart');
    if (!ctx) return;

    if (depositsChart) depositsChart.destroy();

    const total = perDeposit.reduce((s, v) => s + v, 0);
    const totalTextEl = document.getElementById('totalDepositsText');
    if (totalTextEl) totalTextEl.textContent = `${formatAmount(total)} €`;

    depositsChart = new Chart(ctx, {
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Ingreso (EUR)',
                    data: perDeposit,
                    backgroundColor: '#60a5fa'
                },
                {
                    type: 'line',
                    label: 'Depósitos acumulados (EUR)',
                    data: data,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16,185,129,0.12)',
                    tension: 0.35,
                    fill: false,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: true } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: (v) => `${formatAmount(v)} €` }
                }
            }
        }
    });
}

// (Removed calculateSummary - it was unused)

// --------------------
// Portfolio con transacciones desplegables
// --------------------

function parseTradeFromDescripcion(descripcion) {
    // Formatos esperados:
    // "Compra 40 United Parcel Serv.B@91,95 USD (US9113121068)"
    // "Venta 121 NATURGY ENERGY GROUP SA@26,22 EUR (ES0116870314)"
    if (!descripcion) return null;
    let text = descripcion.trim();

    // Caso especial: si la descripción empieza con un prefijo como "ESCISIÓN:",
    // queremos parsear la parte posterior al ':' que contiene la operación
    // p.ej. "ESCISIÓN: Compra 2 Solventum Corp@0 USD (US83444M1018)"
    if (/^escis/i.test(text)) {
        const colonIndex = text.indexOf(':');
        if (colonIndex !== -1) {
            text = text.substring(colonIndex + 1).trim();
        }
    }

    // 1) Acción: primera palabra
    const firstSpace = text.indexOf(' ');
    if (firstSpace === -1) return null;
    const action = text.substring(0, firstSpace).toLowerCase(); // compra/venta

    // Solo procesamos compra/venta
    if (action !== 'compra' && action !== 'venta') return null;

    // 2) Cantidad: número tras el primer espacio
    const rest1 = text.substring(firstSpace + 1).trim();
    const qtyMatch = rest1.match(/^(\d+)/);
    if (!qtyMatch) return null;
    const quantity = parseInt(qtyMatch[1], 10);

    // 3) Después va el nombre del producto hasta el símbolo '@'
    const afterQty = rest1.substring(qtyMatch[0].length).trim();
    const atIndex = afterQty.indexOf('@');
    if (atIndex === -1) return null;
    const product = afterQty.substring(0, atIndex).trim();

    // 4) Precio hasta antes de " ("
    const afterAt = afterQty.substring(atIndex + 1);
    const parenIndex = afterAt.indexOf('(');
    const pricePart = (parenIndex === -1 ? afterAt : afterAt.substring(0, parenIndex)).trim();
    // pricePart suele ser como "91,95 USD" o "26,22 EUR" -> separar número y moneda
    // Aceptar tanto enteros como decimales, y formatos con separadores de miles
    const priceNumMatch = pricePart.match(/([0-9]+(?:[\.,][0-9]+)?)/);
    const currencyMatch = pricePart.match(/\b([A-Z]{3})\b/);
    const priceStr = priceNumMatch ? priceNumMatch[1] : null;
    const currency = currencyMatch ? currencyMatch[1] : '';
    const price = priceStr ? parseAmount(priceStr) : null;

    return { action, quantity, product, price, currency };
}

function buildAndRenderPortfolio() {
    // Acumular posiciones por ISIN o Producto usando FIFO
    const positions = new Map(); // key: ISIN o Producto -> { product, isin, currency, shares, totalCost, trades[], lots[] }

    // Filtrar solo compras y ventas
    const trades = allTransactions.filter(t => {
        const d = (t.descripcion || '').toLowerCase();
        return d.includes('compra') || d.includes('venta');
    });

    // Ordenar por fecha (más antiguo primero)
    trades.sort((a, b) => parseDateTime(a.fecha, a.hora) - parseDateTime(b.fecha, b.hora));

    trades.forEach(t => {
        const parsed = parseTradeFromDescripcion(t.descripcion || '');
        if (!parsed || parsed.price == null || !parsed.quantity) return;

        // Usar ISIN como identificador principal, si no existe usar producto
        const key = (t.isin && t.isin.trim()) ? t.isin.trim() : (t.producto || parsed.product || '').trim();
        if (!key) return;

        const currency = parsed.currency || t.moneda1 || t.moneda2 || 'EUR';
        const productName = t.producto || parsed.product || key;

        if (!positions.has(key)) {
            positions.set(key, {
                product: productName,
                isin: t.isin || '-',
                currency: currency,
                shares: 0,
                totalCost: 0,
                trades: [],
                lots: []  // Array de lotes para FIFO: [{shares, price}]
            });
        }

        const pos = positions.get(key);
        const isBuy = parsed.action === 'compra';
        const qty = parsed.quantity;
        const price = parsed.price;

        // Guardar el trade
        pos.trades.push({
            date: t.fecha,
            action: parsed.action,
            quantity: qty,
            price: price
        });

        if (isBuy) {
            // Compra: añadir nuevo lote FIFO
            pos.lots.push({ shares: qty, price: price });
            pos.shares += qty;
            pos.totalCost += (price * qty);
        } else {
            // Venta FIFO: consumir lotes desde el más antiguo
            let remaining = qty;
            const lotsToRemove = [];
            
            for (let i = 0; i < pos.lots.length && remaining > 0; i++) {
                const lot = pos.lots[i];
                const consume = Math.min(remaining, lot.shares);
                
                // Reducir el lote
                lot.shares -= consume;
                remaining -= consume;
                
                // Marcar lote vacío para eliminar
                if (lot.shares <= 1e-12) {
                    lotsToRemove.push(i);
                }
            }
            
            // Eliminar lotes vacíos (de atrás hacia adelante)
            for (let i = lotsToRemove.length - 1; i >= 0; i--) {
                pos.lots.splice(lotsToRemove[i], 1);
            }
            
            // Recalcular totales desde los lotes restantes
            pos.shares = pos.lots.reduce((sum, lot) => sum + lot.shares, 0);
            pos.totalCost = pos.lots.reduce((sum, lot) => sum + (lot.shares * lot.price), 0);
            
            // Redondear para evitar errores de precisión
            if (pos.shares < 0.0001) {
                pos.shares = 0;
                pos.totalCost = 0;
                pos.lots = [];
            }
        }
    });

    // Renderizar tabla con filas expandibles
    const tbody = document.getElementById('portfolioBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const activePositions = Array.from(positions.values())
        .filter(p => p.shares > 0)
        .sort((a, b) => a.product.localeCompare(b.product));

    if (activePositions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #6b7280; padding: 2rem;">No hay posiciones activas</td></tr>';
        return;
    }

    activePositions.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.className = 'portfolio-row';
        tr.style.cursor = 'pointer';
        tr.dataset.key = `position-${index}`;
        
        const breakEven = p.shares > 0 ? (p.totalCost / p.shares) : 0;
        const totalValue = breakEven * p.shares;
        
        tr.innerHTML = `
            <td style="text-align: center; width: 30px;">
                <span class="expand-icon" style="display: inline-block; transition: transform 0.2s;">▶</span>
            </td>
            <td><strong>${p.product}</strong></td>
            <td><small style="color: #6b7280;">${p.isin}</small></td>
            <td style="text-align: center;">${p.shares}</td>
            <td style="text-align: right;"><strong>${formatAmount(breakEven)}</strong> ${p.currency}</td>
            <td style="text-align: right; color: #10b981; font-weight: 600;">${formatAmount(totalValue)} ${p.currency}</td>
        `;
        
        // Click handler para expandir/contraer
        tr.addEventListener('click', function() {
            const detailsRow = tbody.querySelector(`tr[data-details-for="position-${index}"]`);
            const icon = this.querySelector('.expand-icon');
            
            if (detailsRow) {
                // Ya existe, remover
                detailsRow.remove();
                icon.style.transform = 'rotate(0deg)';
            } else {
                // Crear fila de detalles
                const detailsTr = document.createElement('tr');
                detailsTr.dataset.detailsFor = `position-${index}`;
                detailsTr.style.backgroundColor = '#f8fafc';
                
                // Crear tabla de transacciones
                let tradesHTML = `
                    <td colspan="6" style="padding: 1rem 2rem;">
                        <div style="max-height: 400px; overflow-y: auto;">
                            <h4 style="margin-bottom: 0.75rem; color: #374151;">📋 Historial de transacciones</h4>
                            <table style="width: 100%; font-size: 0.9rem;">
                                <thead style="background: #e5e7eb;">
                                    <tr>
                                        <th style="padding: 0.5rem;">Fecha</th>
                                        <th style="padding: 0.5rem;">Tipo</th>
                                        <th style="padding: 0.5rem; text-align: center;">Acciones</th>
                                        <th style="padding: 0.5rem; text-align: right;">Precio/Acción</th>
                                        <th style="padding: 0.5rem; text-align: right;">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;
                
                p.trades.forEach(trade => {
                    const typeClass = trade.action === 'compra' ? 'background: #dcfce7; color: #166534;' : 'background: #fee2e2; color: #991b1b;';
                    const typeText = trade.action === 'compra' ? '🛒 Compra' : '📤 Venta';
                    const total = trade.price * trade.quantity;
                    
                    tradesHTML += `
                        <tr>
                            <td style="padding: 0.5rem;">${trade.date}</td>
                            <td style="padding: 0.5rem;">
                                <span style="padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 600; ${typeClass}">
                                    ${typeText}
                                </span>
                            </td>
                            <td style="padding: 0.5rem; text-align: center;">${trade.quantity}</td>
                            <td style="padding: 0.5rem; text-align: right;">${formatAmount(trade.price)} ${p.currency}</td>
                            <td style="padding: 0.5rem; text-align: right; font-weight: 600;">${formatAmount(total)} ${p.currency}</td>
                        </tr>
                    `;
                });
                
                tradesHTML += `
                                </tbody>
                            </table>
                        </div>
                    </td>
                `;
                
                detailsTr.innerHTML = tradesHTML;
                tr.after(detailsTr);
                icon.style.transform = 'rotate(90deg)';
            }
        });
        
        tbody.appendChild(tr);
    });
}

// Filtrar portfolio por búsqueda
function filterPortfolio() {
    const searchTerm = searchProduct.value.toLowerCase();
    const rows = document.querySelectorAll('#portfolioBody tr.portfolio-row');
    
    rows.forEach(row => {
        const productText = row.textContent.toLowerCase();
        const detailsRow = document.querySelector(`tr[data-details-for="${row.dataset.key}"]`);
        
        if (productText.includes(searchTerm)) {
            row.style.display = '';
            if (detailsRow) detailsRow.style.display = '';
        } else {
            row.style.display = 'none';
            if (detailsRow) detailsRow.style.display = 'none';
        }
    });
}
