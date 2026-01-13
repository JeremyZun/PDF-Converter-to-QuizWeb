let extractedImages = {};
let currentMode = 'visual'; // 預設為圖形化模式

// ==========================================
// UI 控制輔助函式 (保留進度條)
// ==========================================
function setLoadingState(isLoading, initialText = "準備中...") {
    const btnPdf = document.getElementById('btn-upload-pdf');
    const btnJson = document.getElementById('btn-upload-json');
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');

    if (isLoading) {
        if(btnPdf) btnPdf.disabled = true;
        if(btnJson) btnJson.disabled = true;
        if(btnPdf) btnPdf.innerText = "處理中...";
        if(btnJson) btnJson.innerText = "處理中...";
        
        if(progressContainer) progressContainer.classList.remove('hidden');
        if(progressFill) progressFill.style.width = '0%';
        if(progressText) progressText.innerText = initialText;
    } else {
        setTimeout(() => {
            if(btnPdf) btnPdf.disabled = false;
            if(btnJson) btnJson.disabled = false;
            if(btnPdf) btnPdf.innerText = "選擇 PDF 檔案";
            if(btnJson) btnJson.innerText = "選擇 JSON 檔案";
            if(progressContainer) progressContainer.classList.add('hidden');
        }, 500);
    }
}

function updateProgress(percent, text) {
    const progressFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    if(progressFill) progressFill.style.width = `${percent}%`;
    if(text && progressText) progressText.innerText = text;
}

// ==========================================
// 1. PDF 處理主流程
// ==========================================
async function processPDF() {
    const fileInput = document.getElementById('file-input-pdf');
    if (!fileInput.files[0]) return alert("請先選擇 PDF 檔案");

    const file = fileInput.files[0];
    setLoadingState(true, "正在讀取 PDF 檔案...");

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = "";
        extractedImages = {};
        let imgCount = 0;

        updateProgress(5, `偵測到 ${pdf.numPages} 頁，開始解析...`);

        for (let i = 1; i <= pdf.numPages; i++) {
            const percent = Math.round((i / pdf.numPages) * 90);
            updateProgress(percent, `正在解析第 ${i} / ${pdf.numPages} 頁...`);

            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(" ") + "\n";

            const ops = await page.getOperatorList();
            for (let j = 0; j < ops.fnArray.length; j++) {
                if (ops.fnArray[j] === pdfjsLib.OPS.paintImageXObject) {
                    const imgName = ops.argsArray[j][0];
                    try {
                        const imageObj = await page.objs.get(imgName);
                        const base64Url = await convertImageToBase64(imageObj);
                        const imgId = `img_${imgCount++}`;
                        extractedImages[imgId] = base64Url;
                    } catch (e) { console.warn("圖片提取失敗", e); }
                }
            }
        }

        updateProgress(95, "正在識別題目...");
        
        setTimeout(() => {
            const parsedData = parseTextToQuiz(fullText);
            
            document.getElementById('json-textarea').value = JSON.stringify(parsedData, null, 4);
            renderImageGallery();
            renderVisualEditor(parsedData); 

            updateProgress(100, "解析完成！");
            setLoadingState(false);

            document.getElementById('step-upload').classList.add('hidden');
            document.getElementById('step-edit').classList.remove('hidden');
            switchMode('visual');
        }, 100);

    } catch (err) {
        setLoadingState(false);
        alert("解析失敗：" + err.message);
        console.error(err);
    } finally {
        fileInput.value = ''; 
    }
}

// ==========================================
// 2. JSON 上傳處理
// ==========================================
async function processJSON() {
    const fileInput = document.getElementById('file-input-json');
    if (!fileInput.files[0]) return;

    const file = fileInput.files[0];
    setLoadingState(true, "正在讀取 JSON 題庫...");

    const reader = new FileReader();

    reader.onprogress = function(e) {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 50);
            updateProgress(percent, "正在載入檔案...");
        }
    };

    reader.onload = function(e) {
        try {
            updateProgress(60, "正在還原數據...");
            
            setTimeout(() => {
                const jsonContent = e.target.result;
                const data = JSON.parse(jsonContent);

                if (!Array.isArray(data)) throw new Error("JSON 格式錯誤");

                extractedImages = {}; 
                
                const processedData = data.map((q, index) => {
                    if (q.img && q.img.startsWith('data:image')) {
                        const newId = `img_restored_${index}`;
                        extractedImages[newId] = q.img;
                        return { ...q, img: newId };
                    } 
                    else if (q.img && !q.img.startsWith('img_')) {
                        return { ...q, img: null };
                    }
                    return q;
                });

                document.getElementById('json-textarea').value = JSON.stringify(processedData, null, 4);
                renderImageGallery();
                renderVisualEditor(processedData);

                updateProgress(100, "載入完成！");
                setLoadingState(false);

                document.getElementById('step-upload').classList.add('hidden');
                document.getElementById('step-edit').classList.remove('hidden');
                switchMode('visual');

            }, 50); 

        } catch (err) {
            setLoadingState(false);
            alert("載入失敗：" + err.message);
        }
    };

    reader.readAsText(file);
    fileInput.value = ''; 
}

// ==========================================
// 3. 核心解析器
// ==========================================
function parseTextToQuiz(text) {
    let cleanText = text.replace(/\r\n/g, "\n");
    const rawBlocks = cleanText.split(/(?:^|[\s\n])(?=\d+[\.、]\s)/).filter(b => b.trim().length > 0);

    let blocksToProcess = rawBlocks;
    if (rawBlocks.length <= 1 && cleanText.length > 100) {
        const fallback = cleanText.split(/(?=\d+\.)/).filter(b => b.trim().length > 0);
        if (fallback.length > 1) blocksToProcess = fallback;
    }

    return blocksToProcess.map((block, index) => {
        let content = block.replace(/^\s*\d+[\.、\s]+/, '').trim();
        let qObj = {
            id: index + 1,
            question: content,
            options: [],
            answer: 0,
            img: null
        };

        let parts = content.split(/[\(（]\s*[A-D]\s*[\)）][\.\s]*|[A-D][\.\、]\s+/);
        
        if (parts.length >= 2) {
            qObj.question = parts[0].trim();
            qObj.options = parts.slice(1).map(p => p.trim()).filter(p => p);
        } else {
            qObj.options = ["選項 A", "選項 B", "選項 C", "選項 D"];
        }

        return qObj;
    });
}

// ==========================================
// 4. 視覺化編輯器 (支援增刪選項與題目)
// ==========================================
function renderVisualEditor(data) {
    const container = document.getElementById('visual-editor');
    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding: 40px; color:#666;">
                <p>⚠️ 尚未偵測到任何題目</p>
                <p style="font-size:12px;">(可能是 PDF 格式特殊，請點擊下方按鈕手動新增)</p>
            </div>`;
    }

    data.forEach((q, index) => {
        const card = document.createElement('div');
        card.className = 'q-card';
        card.dataset.index = index;

        // 生成選項 HTML (動態列表)
        let optionsHtml = '';
        q.options.forEach((opt, optIdx) => {
            optionsHtml += `
                <div class="option-row">
                    <label class="form-label" style="width:50px;">${String.fromCharCode(65 + optIdx)}</label>
                    <input type="text" class="form-input inp-option" value="${opt}" placeholder="輸入選項內容...">
                    <button class="btn-icon btn-del-opt" onclick="removeOption(${index}, ${optIdx})" title="刪除此選項">✕</button>
                </div>
            `;
        });

        // 答案下拉選單
        let answerSelect = `<select class="form-input inp-answer">`;
        q.options.forEach((_, idx) => {
            answerSelect += `<option value="${idx}" ${q.answer === idx ? 'selected' : ''}>選項 ${String.fromCharCode(65 + idx)}</option>`;
        });
        answerSelect += `</select>`;

        // 刪除題目的按鈕
        const deleteBtn = `
            <button onclick="deleteQuestion(${index})" class="btn-icon btn-del-q" style="position:absolute; top:15px; right:15px; border:1px solid #fee2e2; padding:5px 10px; font-size:12px;">
                🗑️ 刪除此題
            </button>
        `;

        card.innerHTML = `
            ${deleteBtn}
            <div class="form-group">
                <label class="form-label"><strong>第 ${index + 1} 題</strong></label>
                <textarea class="form-input inp-question" rows="2">${q.question}</textarea>
            </div>
            
            <div class="form-group">
                <label class="form-label">選項列表</label>
                <div class="options-container">
                    ${optionsHtml}
                </div>
                <button onclick="addOption(${index})" class="btn-add-opt">+ 新增選項</button>
            </div>

            <div class="meta-row">
                <div style="flex:1;">
                    <label class="form-label">正確答案</label>
                    ${answerSelect}
                </div>
                <div style="flex:1;">
                    <label class="form-label">圖片 ID (選填)</label>
                    <input type="text" class="form-input inp-img" value="${q.img || ''}" placeholder="例如: img_1">
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // 底部「新增一題」按鈕
    const addBtnDiv = document.createElement('div');
    addBtnDiv.style.marginTop = "20px";
    addBtnDiv.style.marginBottom = "40px";
    addBtnDiv.innerHTML = `
        <button onclick="addQuestion()" class="btn-primary" style="width:100%; padding:15px; font-size:16px; border-radius:8px; display:flex; align-items:center; justify-content:center; gap:10px; box-shadow:0 4px 6px rgba(0,0,0,0.1);">
            <span style="font-size:20px; font-weight:bold;">＋</span> 新增一題
        </button>
    `;
    container.appendChild(addBtnDiv);
}

// ==========================================
// 5. 互動功能 (題目增刪、選項增刪)
// ==========================================

// [題目] 刪除
window.deleteQuestion = function(index) {
    if(!confirm("確定要刪除第 " + (index+1) + " 題嗎？")) return;
    syncVisualToJSON();
    const ta = document.getElementById('json-textarea');
    let data = JSON.parse(ta.value);
    
    data.splice(index, 1);
    data = data.map((q, i) => ({ ...q, id: i + 1 })); // 重新編號 ID
    
    ta.value = JSON.stringify(data, null, 4);
    renderVisualEditor(data);
};

// [題目] 新增
window.addQuestion = function() {
    syncVisualToJSON();
    const ta = document.getElementById('json-textarea');
    let data = [];
    try { data = JSON.parse(ta.value); } catch(e) {}
    
    const newQuestion = {
        id: data.length + 1,
        question: "請輸入題目...",
        options: ["", "", "", ""], 
        answer: 0,
        img: null
    };
    
    data.push(newQuestion);
    ta.value = JSON.stringify(data, null, 4);
    renderVisualEditor(data);
    
    setTimeout(() => {
        const container = document.getElementById('visual-editor');
        container.scrollTop = container.scrollHeight;
    }, 100);
};

// [選項] 新增
window.addOption = function(qIndex) {
    syncVisualToJSON();
    const ta = document.getElementById('json-textarea');
    let data = JSON.parse(ta.value);
    
    // 新增一個空白選項
    data[qIndex].options.push("");
    
    ta.value = JSON.stringify(data, null, 4);
    renderVisualEditor(data);
};

// [選項] 刪除
window.removeOption = function(qIndex, optIndex) {
    syncVisualToJSON();
    const ta = document.getElementById('json-textarea');
    let data = JSON.parse(ta.value);
    
    // 如果只剩兩個選項，建議不要再刪了 (雖然沒強制禁止)
    if(data[qIndex].options.length <= 2) {
        if(!confirm("選項太少可能不符合測驗需求，確定要刪除嗎？")) return;
    }

    // 刪除該選項
    data[qIndex].options.splice(optIndex, 1);

    // [防呆] 如果刪除的選項是正確答案，或正確答案索引超出範圍，重置為 0
    if (data[qIndex].answer === optIndex || data[qIndex].answer >= data[qIndex].options.length) {
        data[qIndex].answer = 0;
    } else if (data[qIndex].answer > optIndex) {
        // 如果刪除的是正確答案之前的選項，正確答案索引要 -1
        data[qIndex].answer -= 1;
    }
    
    ta.value = JSON.stringify(data, null, 4);
    renderVisualEditor(data);
};

// ==========================================
// 6. 其他輔助函式
// ==========================================

function switchMode(mode) {
    const visualBtn = document.getElementById('btn-visual');
    const codeBtn = document.getElementById('btn-code');
    const visualDiv = document.getElementById('visual-editor');
    const codeDiv = document.getElementById('code-editor');
    const textarea = document.getElementById('json-textarea');

    if (mode === 'visual') {
        try {
            const data = JSON.parse(textarea.value);
            renderVisualEditor(data);
            visualDiv.classList.remove('hidden');
            codeDiv.classList.add('hidden');
            visualBtn.classList.add('active');
            codeBtn.classList.remove('active');
            currentMode = 'visual';
        } catch (e) {
            alert("JSON 格式錯誤");
        }
    } else {
        if (currentMode === 'visual') syncVisualToJSON();
        visualDiv.classList.add('hidden');
        codeDiv.classList.remove('hidden');
        visualBtn.classList.remove('active');
        codeBtn.classList.add('active');
        currentMode = 'code';
    }
}

function syncVisualToJSON() {
    const cards = document.querySelectorAll('.q-card');
    const newData = [];
    cards.forEach(card => {
        const question = card.querySelector('.inp-question').value;
        const img = card.querySelector('.inp-img').value.trim() || null;
        
        // 抓取所有選項
        const options = Array.from(card.querySelectorAll('.inp-option')).map(inp => inp.value);
        const answer = parseInt(card.querySelector('.inp-answer').value);
        
        newData.push({ 
            id: parseInt(card.dataset.index) + 1, 
            question, 
            options, 
            answer, 
            img 
        });
    });
    document.getElementById('json-textarea').value = JSON.stringify(newData, null, 4);
}

function cleanWhitespace() {
    if (currentMode === 'visual') syncVisualToJSON();
    const textarea = document.getElementById('json-textarea');
    let data;
    try { data = JSON.parse(textarea.value); } catch (e) { return alert("JSON 格式有誤"); }

    const cleanedData = data.map(q => {
        let newQ = { ...q, question: smartTrim(q.question) };
        if (q.options) newQ.options = q.options.map(opt => smartTrim(opt));
        return newQ;
    });

    textarea.value = JSON.stringify(cleanedData, null, 4);
    if (currentMode === 'visual') renderVisualEditor(cleanedData);
    
    showStatusMsg("✅ 排版已優化：清除多餘空格");
}

function smartTrim(str) {
    if (!str) return "";
    return str.replace(/\s+/g, ' ')
        .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
        .replace(/\s+([，。、？！：；「」『』（）])/g, '$1')
        .replace(/([，。、？！：；「」『』（）])\s+/g, '$1')
        .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
        .trim();
}

function showStatusMsg(msg) {
    const el = document.getElementById('status-msg');
    if (el) { el.innerText = msg; el.style.color = "green"; setTimeout(() => { el.innerText = ""; }, 2000); }
}

function formatJSON() {
    const ta = document.getElementById('json-textarea');
    try { ta.value = JSON.stringify(JSON.parse(ta.value), null, 4); alert("格式已修正！"); } catch (e) { alert("格式錯誤"); }
}

function convertImageToBase64(imgObj) {
    return new Promise((resolve) => {
        const MAX_WIDTH = 600;
        let width = imgObj.width;
        let height = imgObj.height;
        if (width > MAX_WIDTH) { const scale = MAX_WIDTH / width; width = MAX_WIDTH; height = Math.round(height * scale); }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d');
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, width, height);
        
        if (imgObj.bitmap) { ctx.drawImage(imgObj.bitmap, 0, 0, width, height); } 
        else { const tCanvas = document.createElement('canvas'); tCanvas.width = imgObj.width; tCanvas.height = imgObj.height; const tCtx = tCanvas.getContext('2d'); const data = new ImageData(new Uint8ClampedArray(imgObj.data), imgObj.width, imgObj.height); tCtx.putImageData(data, 0, 0); ctx.drawImage(tCanvas, 0, 0, width, height); }
        resolve(canvas.toDataURL('image/jpeg', 0.8));
    });
}

function renderImageGallery() {
    const gallery = document.getElementById('image-gallery'); gallery.innerHTML = '';
    if (Object.keys(extractedImages).length === 0) { gallery.innerHTML = '<p style="color:#999;font-size:12px;">無圖片</p>'; return; }
    for (const [id, src] of Object.entries(extractedImages)) {
        const div = document.createElement('div'); div.className = 'gallery-item'; div.id = `gallery-${id}`;
        div.innerHTML = `<div class="img-wrapper"><img src="${src}" onclick="previewImage('${src}')"></div><div class="img-controls"><span class="badge" style="background:#eee;color:#333">${id}</span><div><button class="btn-icon btn-copy" onclick="copyId('${id}')">複製</button><button class="btn-icon btn-del" onclick="deleteImage('${id}')">刪</button></div></div>`;
        gallery.appendChild(div);
    }
}

window.copyId = function(id) {
    navigator.clipboard.writeText(id).then(() => {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('inp-img')) activeEl.value = id;
        else alert(`已複製 ${id}`);
    });
};

window.deleteImage = function(id) { delete extractedImages[id]; const el = document.getElementById(`gallery-${id}`); if (el) el.remove(); };
window.previewImage = function(src) { const w = window.open(""); w.document.write(`<img src="${src}" style="max-width:100%">`); };

function downloadJSON() {
    if (currentMode === 'visual') syncVisualToJSON();
    const jsonContent = document.getElementById('json-textarea').value;
    let data; try { data = JSON.parse(jsonContent); } catch (e) { return alert("JSON 錯誤"); }

    const exportData = data.map(q => {
        if (q.img && extractedImages[q.img]) return { ...q, img: extractedImages[q.img] };
        return q;
    });

    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "quiz_data_with_images.json"; link.click();
}

function openQuizPage() {
    if (currentMode === 'visual') syncVisualToJSON();
    const jsonContent = document.getElementById('json-textarea').value;
    let quizDataRaw; try { quizDataRaw = JSON.parse(jsonContent); } catch (e) { return alert("JSON 錯誤"); }

    const finalQuizData = quizDataRaw.map(q => ({
        ...q,
        img: (q.img && extractedImages[q.img]) ? extractedImages[q.img] : null
    }));

    try {
        sessionStorage.setItem('currentQuizData', JSON.stringify(finalQuizData));
        window.open('quiz.html', '_blank');
    } catch (e) {
        if (e.name === 'QuotaExceededError') alert("圖片過多容量不足，請刪除部分圖片。");
        else alert("錯誤：" + e.message);
    }
}