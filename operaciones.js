function calculatePositions(method = 'average') {
    const normalizedMethod = method === 'fifo' ? 'fifo' : 'average';
    const positions = new Map();

    const trades = allTransactions.filter((t) => {
        const d = (t.descripcion || '').toLowerCase();
        return d.includes('compra') || d.includes('venta');
    });

    trades.sort((a, b) => parseDateTime(a.fecha, a.hora) - parseDateTime(b.fecha, b.hora));

    trades.forEach((t, index) => {
        const parsed = parseTradeFromDescripcion(t.descripcion || '');
        if (!parsed || parsed.price == null || !parsed.quantity) return;

        const key = (t.isin && t.isin.trim()) ? t.isin.trim() : (t.producto || parsed.product || '').trim();
        if (!key) return;

        const currency = parsed.currency || t.moneda1 || t.moneda2 || 'EUR';

        if (!positions.has(key)) {
            positions.set(key, {
                shares: 0,           // Total de acciones que tengo
                totalCost: 0,        // Coste total de las acciones que tengo
                currency,
                history: [],
                lots: []             // Solo para FIFO: array de {shares, price}
            });
        }

        const pos = positions.get(key);
        pos.currency = currency;

        const qty = parsed.quantity;
        const price = parsed.price;
        const action = parsed.action;

        if (action === 'compra') {
            // ===== COMPRA =====
            
            if (normalizedMethod === 'fifo') {
                // FIFO: Guardar el lote
                pos.lots.push({ shares: qty, price });
            }
            
            // Actualizar totales
            pos.shares += qty;
            pos.totalCost += price * qty;

            // Media de la posición DESPUÉS de la compra
            const avgPosition = pos.shares > 0 ? pos.totalCost / pos.shares : 0;

            pos.history.push({
                idOrden: (t.idOrden || '').trim() || null,
                date: t.fecha,
                hora: t.hora || null,
                action,
                price,
                currency,
                quantity: qty,
                avgSale: null,           // No aplica en compras
                avgPosition: avgPosition, // Media de la posición después de comprar
                profitLoss: null,
                index
            });
            return;
        }

        if (action !== 'venta') {
            return;
        }

        // ===== VENTA =====
        
        if (normalizedMethod === 'fifo') {
            // ===== MÉTODO FIFO =====
            let remaining = qty;
            let soldShares = 0;
            let totalCostOfSoldShares = 0;

            console.log(`[VENTA FIFO] ${t.fecha} - Vendiendo ${qty} acciones @ ${price}`);
            console.log(`[VENTA FIFO] Lotes disponibles ANTES:`, JSON.parse(JSON.stringify(pos.lots)));

            // Consumir lotes desde el más antiguo
            const lotsToRemove = [];
            for (let i = 0; i < pos.lots.length && remaining > 0; i++) {
                const lot = pos.lots[i];
                const consume = Math.min(remaining, lot.shares);
                
                console.log(`[VENTA FIFO] Consumiendo ${consume} acciones del lote ${i} (precio: ${lot.price}, disponibles: ${lot.shares})`);
                
                soldShares += consume;
                totalCostOfSoldShares += consume * lot.price;
                
                lot.shares -= consume;
                remaining -= consume;

                if (lot.shares <= 1e-12) {
                    lotsToRemove.push(i);
                }
            }

            console.log(`[VENTA FIFO] Total vendido: ${soldShares} acciones por un coste de ${totalCostOfSoldShares}`);
            console.log(`[VENTA FIFO] Media Venta: ${totalCostOfSoldShares / soldShares}`);

            // Eliminar lotes vacíos (de atrás hacia adelante para no afectar índices)
            for (let i = lotsToRemove.length - 1; i >= 0; i--) {
                pos.lots.splice(lotsToRemove[i], 1);
            }

            console.log(`[VENTA FIFO] Lotes disponibles DESPUÉS:`, JSON.parse(JSON.stringify(pos.lots)));

            // Recalcular totales desde los lotes restantes
            pos.shares = pos.lots.reduce((sum, lot) => sum + lot.shares, 0);
            pos.totalCost = pos.lots.reduce((sum, lot) => sum + lot.shares * lot.price, 0);

            // MEDIA VENTA: coste promedio de las acciones vendidas (de los lotes más antiguos)
            const avgSale = soldShares > 0 ? totalCostOfSoldShares / soldShares : 0;
            
            // MEDIA POSICIÓN: coste promedio de las acciones que QUEDAN
            const avgPosition = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
            
            // GANANCIA/PÉRDIDA: (precio venta - media venta) * acciones vendidas
            const profitLoss = soldShares > 0 ? (price - avgSale) * soldShares : null;

            console.log(`[VENTA FIFO] Resultado - avgSale: ${avgSale}, avgPosition: ${avgPosition}, profitLoss: ${profitLoss}\n`);

            pos.history.push({
                idOrden: (t.idOrden || '').trim() || null,
                date: t.fecha,
                hora: t.hora || null,
                action,
                price,
                currency,
                quantity: soldShares,
                avgSale: avgSale,
                avgPosition: avgPosition,
                profitLoss: profitLoss,
                index
            });

        } else {
            // ===== MÉTODO PROMEDIO PONDERADO =====
            const sharesToSell = Math.min(qty, pos.shares);
            
            // MEDIA VENTA: en promedio ponderado es la media actual
            const avgSale = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
            
            // Actualizar totales
            pos.shares -= sharesToSell;
            pos.totalCost -= avgSale * sharesToSell;

            if (pos.shares <= 1e-12) {
                pos.shares = 0;
                pos.totalCost = 0;
            }

            // MEDIA POSICIÓN: en promedio ponderado sigue siendo la misma
            const avgPosition = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
            
            // GANANCIA/PÉRDIDA: (precio venta - media venta) * acciones vendidas
            const profitLoss = sharesToSell > 0 ? (price - avgSale) * sharesToSell : null;

            pos.history.push({
                idOrden: (t.idOrden || '').trim() || null,
                date: t.fecha,
                hora: t.hora || null,
                action,
                price,
                currency,
                quantity: sharesToSell,
                avgSale: avgSale,
                avgPosition: avgPosition,
                profitLoss: profitLoss,
                index
            });
        }
    });

    return positions;
}

// --------------------
// Datos y carga inicial
// --------------------

// Variables globales
let allTransactions = [];
let filteredTransactions = [];

// Elementos del DOM
const dashboard = document.getElementById('dashboard');
const transactionsBody = document.getElementById('transactionsBody');
const searchProduct = document.getElementById('searchProduct');
const filterMonth = document.getElementById('filterMonth');
const clearFiltersBtn = document.getElementById('clearFilters');
const transactionCount = document.getElementById('transactionCount');
const filterChipsContainer = document.getElementById('filterChips');
const calcMethodInputs = document.querySelectorAll('input[name="calcMethod"]');

// Método de cálculo seleccionado (FIFO por defecto)
let calculationMethod = 'fifo';
try {
    const storedMethod = localStorage.getItem('degiro.operations.calcMethod');
    if (storedMethod === 'fifo' || storedMethod === 'average') {
        calculationMethod = storedMethod;
    }
} catch (_) {}

if (calcMethodInputs.length > 0) {
    let hasMatch = false;
    calcMethodInputs.forEach((input) => {
        if (input.value === calculationMethod) {
            input.checked = true;
            hasMatch = true;
        }
        input.addEventListener('change', (event) => {
            if (!event.target.checked) return;
            calculationMethod = event.target.value === 'fifo' ? 'fifo' : 'average';
            try {
                localStorage.setItem('degiro.operations.calcMethod', calculationMethod);
            } catch (_) {}
            displayTransactionsTable();
        });
    });
    if (!hasMatch && calcMethodInputs[0]) {
        calcMethodInputs[0].checked = true;
        calculationMethod = calcMethodInputs[0].value === 'fifo' ? 'fifo' : 'average';
    }
}

if (filterChipsContainer) {
    filterChipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        const isActive = btn.classList.contains('active');
        filterChipsContainer.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('active'));
        if (!isActive) {
            btn.classList.add('active');
        }
        if (filterChipsContainer.querySelectorAll('.chip.active').length === 0) {
            filterChipsContainer.classList.add('no-selection');
        } else {
            filterChipsContainer.classList.remove('no-selection');
        }
        applyFilters();
    });
}

// Event Listeners
if (searchProduct) searchProduct.addEventListener('input', applyFilters);
if (filterMonth) filterMonth.addEventListener('change', applyFilters);
if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);

// Cargar desde localStorage al iniciar
window.addEventListener('DOMContentLoaded', loadFromStorage);

function loadFromStorage() {
    let stored = null;
    try {
        stored = localStorage.getItem('degiro.transactions.v1');
    } catch (_) {}

    if (stored) {
        try {
            allTransactions = JSON.parse(stored);
            filteredTransactions = [...allTransactions];
            displayDashboard();
        } catch (e) {
            console.error('Error loading from localStorage:', e);
        }
    }
}

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

function displayDashboard() {
    if (dashboard) {
        dashboard.style.display = 'block';
    }
    displayTransactionsTable();
}

function parseTradeFromDescripcion(descripcion) {
    if (!descripcion) return null;
    let text = descripcion.trim();

    // Caso ESCISIÓN
    if (/^escis/i.test(text)) {
        const colonIndex = text.indexOf(':');
        if (colonIndex !== -1) {
            text = text.substring(colonIndex + 1).trim();
        }
    }

    const firstSpace = text.indexOf(' ');
    if (firstSpace === -1) return null;
    const action = text.substring(0, firstSpace).toLowerCase();

    if (action !== 'compra' && action !== 'venta') return null;

    const rest1 = text.substring(firstSpace + 1).trim();
    const qtyMatch = rest1.match(/^(\d+)/);
    if (!qtyMatch) return null;
    const quantity = parseInt(qtyMatch[1], 10);

    const afterQty = rest1.substring(qtyMatch[0].length).trim();
    const atIndex = afterQty.indexOf('@');
    if (atIndex === -1) return null;
    const product = afterQty.substring(0, atIndex).trim();

    const afterAt = afterQty.substring(atIndex + 1);
    const parenIndex = afterAt.indexOf('(');
    const pricePart = (parenIndex === -1 ? afterAt : afterAt.substring(0, parenIndex)).trim();
    const priceNumMatch = pricePart.match(/([0-9]+(?:[\.,][0-9]+)?)/);
    const currencyMatch = pricePart.match(/\b([A-Z]{3})\b/);
    const priceStr = priceNumMatch ? priceNumMatch[1] : null;
    const currency = currencyMatch ? currencyMatch[1] : '';
    const price = priceStr ? parseAmount(priceStr) : null;

    return { action, quantity, product, price, currency };
}

function findSaleHistoryEntry(position, trans, parsed, markUsed = true) {
    if (!position || !Array.isArray(position.history)) return null;

    const clean = (value) => (value || '').trim();
    const targetId = clean(trans.idOrden);
    const targetDate = trans.fecha;
    const targetTime = clean(trans.hora);
    const targetQty = parsed.quantity;
    const tolerance = 1e-6;

    const markAndReturn = (entry) => {
        if (entry && markUsed) {
            entry.used = true;
        }
        return entry || null;
    };

    if (targetId) {
        const byId = position.history.find(h => !h.used && h.action === 'venta' && clean(h.idOrden) === targetId);
        if (byId) return markAndReturn(byId);
    }

    if (targetDate) {
        const byDate = position.history.find(h => !h.used && h.action === 'venta' &&
            h.date === targetDate &&
            (!targetTime || !h.hora || clean(h.hora) === targetTime) &&
            h.requestedQuantity === targetQty &&
            Math.abs((h.price || 0) - (parsed.price || 0)) < tolerance
        );
        if (byDate) return markAndReturn(byDate);
    }

    const fallback = position.history.find(h => !h.used && h.action === 'venta');
    return markAndReturn(fallback);
}

function displayTransactionsTable() {
    if (!transactionsBody) return;
    transactionsBody.innerHTML = '';
    
    const positions = calculatePositions(calculationMethod);
    
    // Filtrar compras y ventas
    const onlyBuySell = filteredTransactions.filter(t => {
        const d = (t.descripcion || '').toLowerCase();
        return d.includes('compra') || d.includes('venta');
    });

    // Agrupar por producto/ISIN
    const groupedByProduct = new Map();
    
    onlyBuySell.forEach(trans => {
        const parsed = parseTradeFromDescripcion(trans.descripcion || '');
        if (!parsed) return;
        
        const key = (trans.isin && trans.isin.trim()) ? trans.isin.trim() : (trans.producto || '').trim();
        if (!key) return;
        
        if (!groupedByProduct.has(key)) {
            groupedByProduct.set(key, {
                producto: trans.producto,
                isin: trans.isin,
                compras: [],
                ventas: []
            });
        }
        
        const group = groupedByProduct.get(key);
        const tradeData = {
            fecha: trans.fecha,
            parsed: parsed,
            trans: trans
        };
        
        if (parsed.action === 'compra') {
            group.compras.push(tradeData);
        } else if (parsed.action === 'venta') {
            group.ventas.push(tradeData);
        }
    });

    let totalTransactions = 0;

    // Renderizar por grupo - SOLO si tiene ventas
    groupedByProduct.forEach((group, key) => {
        // Filtrar: solo mostrar productos con al menos una venta
        if (group.ventas.length === 0) return;
        
        const position = positions.get(key);
        
        // Combinar compras y ventas en un solo array y ordenar cronológicamente
        const allOperations = [
            ...group.compras.map(c => ({ ...c, type: 'compra' })),
            ...group.ventas.map(v => ({ ...v, type: 'venta' }))
        ].sort((a, b) => {
            const dateA = parseDateTime(a.fecha, a.trans.hora);
            const dateB = parseDateTime(b.fecha, b.trans.hora);
            return dateA - dateB;
        });
        
        // Mostrar operaciones en orden cronológico
        allOperations.forEach((operation, idx) => {
            const parsed = operation.parsed;
            const trans = operation.trans;
            const isCompra = operation.type === 'compra';
            const total = parsed.price * parsed.quantity;
            
            if (isCompra) {
                // COMPRA
                let avgPositionCell = '-';
                if (position && position.history.length > 0) {
                    const historyEntry = position.history.find(h => 
                        h.action === 'compra' && 
                        h.date === operation.fecha && 
                        h.quantity === parsed.quantity &&
                        Math.abs(h.price - parsed.price) < 0.01
                    );
                    
                    if (historyEntry && historyEntry.avgPosition > 0) {
                        avgPositionCell = `<strong>${formatAmount(historyEntry.avgPosition)}</strong> ${parsed.currency}`;
                    }
                }
                
                const row = document.createElement('tr');
                row.style.backgroundColor = idx === 0 ? '#f0f9ff' : '#f8fafc';
                
                row.innerHTML = `
                    <td>${idx === 0 ? `<strong>${group.producto}</strong>` : ''}</td>
                    <td>${idx === 0 ? `<small style="color: #6b7280;">${group.isin || '-'}</small>` : ''}</td>
                    <td>${operation.fecha}</td>
                    <td><span class="badge" style="background: #10b981;">Compra</span></td>
                    <td style="text-align: center;">${parsed.quantity}</td>
                    <td style="text-align: right;"><strong>${formatAmount(parsed.price)}</strong> ${parsed.currency}</td>
                    <td style="text-align: right;"><strong>${formatAmount(total)}</strong> ${parsed.currency}</td>
                    <td style="text-align: right;">-</td>
                    <td style="text-align: right;">${avgPositionCell}</td>
                    <td style="text-align: right;">-</td>
                `;
                
                transactionsBody.appendChild(row);
            } else {
                // VENTA
                let avgSaleCell = '-';
                let avgPositionCell = '-';
                let profitLossCell = '-';
                
                if (position && position.history.length > 0) {
                    const historyEntry = findSaleHistoryEntry(position, trans, parsed);
                    if (historyEntry) {
                        const currency = historyEntry.currency || parsed.currency || trans.moneda1 || trans.moneda2 || 'EUR';

                        // Media Venta
                        if (historyEntry.avgSale > 0) {
                            avgSaleCell = `<strong>${formatAmount(historyEntry.avgSale)}</strong> ${currency}`;
                        }

                        // Media Posición
                        if (historyEntry.avgPosition > 0) {
                            avgPositionCell = `<strong>${formatAmount(historyEntry.avgPosition)}</strong> ${currency}`;
                        } else if (historyEntry.avgPosition === 0) {
                            avgPositionCell = '<span style="color: #6b7280;">Sin acciones</span>';
                        }

                        // Ganancia/Pérdida
                        if (historyEntry.profitLoss != null) {
                            const profitLoss = historyEntry.profitLoss;
                            const profitSymbol = profitLoss >= 0 ? '+' : '';
                            const profitClass = profitLoss >= 0 ? 'positive' : 'negative';

                            profitLossCell = `
                                <div class="amount ${profitClass}" style="font-weight: 700; font-size: 1.1rem;">
                                    ${profitSymbol}${formatAmount(profitLoss)} ${currency}
                                </div>
                            `;
                        }
                    }
                }
                
                const row = document.createElement('tr');
                row.style.backgroundColor = '#fef2f2';
                
                row.innerHTML = `
                    <td>${idx === 0 ? `<strong>${group.producto}</strong>` : ''}</td>
                    <td>${idx === 0 ? `<small style="color: #6b7280;">${group.isin || '-'}</small>` : ''}</td>
                    <td>${operation.fecha}</td>
                    <td><span class="badge" style="background: #ef4444;">Venta</span></td>
                    <td style="text-align: center;">${parsed.quantity}</td>
                    <td style="text-align: right;"><strong>${formatAmount(parsed.price)}</strong> ${parsed.currency}</td>
                    <td style="text-align: right;"><strong>${formatAmount(total)}</strong> ${parsed.currency}</td>
                    <td style="text-align: right;">${avgSaleCell}</td>
                    <td style="text-align: right;">${avgPositionCell}</td>
                    <td style="text-align: right;">${profitLossCell}</td>
                `;
                
                transactionsBody.appendChild(row);
            }
            
            totalTransactions++;
        });
        
        // Línea separadora entre productos
        if (groupedByProduct.size > 1) {
            const separator = document.createElement('tr');
            separator.innerHTML = '<td colspan="8" style="height: 0.5rem; background: transparent; border: none;"></td>';
            transactionsBody.appendChild(separator);
        }
    });
    
    if (transactionCount) {
        transactionCount.textContent = `${totalTransactions} operaciones`;
    }
}

function applyFilters() {
    const searchTerm = (searchProduct?.value || '').toLowerCase();
    let typeFilter = '';
    const activeChip = document.querySelector('#filterChips .chip.active');
    if (activeChip) {
        typeFilter = (activeChip.getAttribute('data-value') || '').toLowerCase();
    }
    const monthFilter = filterMonth ? filterMonth.value : '';

    filteredTransactions = allTransactions.filter(trans => {
        const matchesSearch = !searchTerm || 
            (trans.producto || '').toLowerCase().includes(searchTerm) ||
            (trans.descripcion || '').toLowerCase().includes(searchTerm);
        
        let matchesType = true;
        if (typeFilter) {
            matchesType = (trans.descripcion || '').toLowerCase().includes(typeFilter);
        }
        
            (trans.fecha || '').includes(convertMonthFormat(monthFilter));
            trans.fecha.includes(convertMonthFormat(monthFilter));
        
        return matchesSearch && matchesType && matchesMonth;
    });

    displayTransactionsTable();
}

function convertMonthFormat(monthStr) {
    const [year, month] = monthStr.split('-');
    return `${month}-${year}`;
}

function clearFilters() {
    searchProduct.value = '';
    filterMonth.value = '';
    const chips = document.querySelectorAll('#filterChips .chip');
    chips.forEach((c) => c.classList.remove('active'));
    if (filterChipsContainer) {
        filterChipsContainer.classList.add('no-selection');
    }
    filteredTransactions = [...allTransactions];
    displayTransactionsTable();
}
