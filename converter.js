let extractedImages = {};
let currentMode = 'visual'; // 預設為圖形化模式

// 1. PDF 處理主流程
async function processPDF() {
    // [修正] ID 必須對應 index.html 的 file-input-pdf
    const fileInput = document.getElementById('file-input-pdf');
    if (!fileInput.files[0]) return alert("請先選擇 PDF 檔案");

    const file = fileInput.files[0];
    const arrayBuffer = await file.arrayBuffer();
    
    try {
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        extractedImages = {};
        let imgCount = 0;

        // 解析頁面
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(" ") + "\n";

            // 提取圖片
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

        // 解析文字並初始化
        const parsedData = parseTextToQuiz(fullText);
        
        // 填入 JSON 編輯器
        const jsonStr = JSON.stringify(parsedData, null, 4);
        document.getElementById('json-textarea').value = jsonStr;
        
        // 渲染畫面
        renderImageGallery();
        renderVisualEditor(parsedData); // 初始渲染圖形介面

        // 切換顯示
        document.getElementById('step-upload').classList.add('hidden');
        document.getElementById('step-edit').classList.remove('hidden');
        
        // 確保預設顯示 Visual Mode
        switchMode('visual');

    } catch (err) {
        alert("解析失敗：" + err.message);
        console.error(err);
    }
}

// [新增] 處理 JSON 上傳
async function processJSON() {
    const fileInput = document.getElementById('file-input-json');
    if (!fileInput.files[0]) return;

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const jsonContent = e.target.result;
            const data = JSON.parse(jsonContent);

            if (!Array.isArray(data)) throw new Error("JSON 格式錯誤：根目錄必須是陣列");

            // 清空舊圖庫，準備接收新資料
            extractedImages = {}; 
            let imgRestoredCount = 0;

            // --- 關鍵解包邏輯 ---
            const processedData = data.map((q, index) => {
                // 檢查 img 欄位是否包含 Base64 圖片數據 (特徵是 data:image 開頭)
                if (q.img && q.img.startsWith('data:image')) {
                    
                    // 1. 產生一個新的 ID
                    const newId = `img_restored_${index}`;
                    
                    // 2. 將圖片數據存入全域圖庫變數
                    extractedImages[newId] = q.img;
                    imgRestoredCount++;

                    // 3. 將題目中的數據替換回 ID (讓編輯器保持整潔)
                    return { ...q, img: newId };
                } 
                // 如果原本就是 ID (例如 img_1) 但沒有對應圖片資料，設為 null 避免錯誤
                else if (q.img && !q.img.startsWith('img_')) {
                     return { ...q, img: null };
                }
                return q;
            });

            // 更新 UI
            document.getElementById('json-textarea').value = JSON.stringify(processedData, null, 4);
            
            // 重新渲染畫面
            renderImageGallery(); // 圖片會出現在側邊欄
            renderVisualEditor(processedData); // 題目會出現在編輯區

            // 切換步驟顯示
            document.getElementById('step-upload').classList.add('hidden');
            document.getElementById('step-edit').classList.remove('hidden');
            
            // 預設切換到圖形模式
            switchMode('visual');

            alert(`成功載入！已還原 ${imgRestoredCount} 張圖片。`);

        } catch (err) {
            alert("載入失敗：檔案格式不正確。\n" + err.message);
        }
    };

    reader.readAsText(file);
    // 清空 input 讓同個檔案可以再次觸發 onchange
    fileInput.value = ''; 
}

// 2. 模式切換邏輯 (核心功能)
function switchMode(mode) {
    const visualBtn = document.getElementById('btn-visual');
    const codeBtn = document.getElementById('btn-code');
    const visualDiv = document.getElementById('visual-editor');
    const codeDiv = document.getElementById('code-editor');
    const textarea = document.getElementById('json-textarea');

    if (mode === 'visual') {
        // 從 Code -> Visual：嘗試解析 JSON 並渲染
        try {
            const data = JSON.parse(textarea.value);
            renderVisualEditor(data);
            
            visualDiv.classList.remove('hidden');
            codeDiv.classList.add('hidden');
            visualBtn.classList.add('active');
            codeBtn.classList.remove('active');
            currentMode = 'visual';
        } catch (e) {
            alert("JSON 格式有錯誤，無法切換至圖形模式！\n請先點擊「檢查格式」按鈕修復錯誤。");
        }
    } else {
        // 從 Visual -> Code：將表單數據同步回 JSON 字串
        if (currentMode === 'visual') {
            syncVisualToJSON();
        }
        visualDiv.classList.add('hidden');
        codeDiv.classList.remove('hidden');
        visualBtn.classList.remove('active');
        codeBtn.classList.add('active');
        currentMode = 'code';
    }
}

// 3. 渲染圖形化編輯器 (Mass Market Friendly Feature)
function renderVisualEditor(data) {
    const container = document.getElementById('visual-editor');
    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#666;">沒有偵測到題目，請檢查 PDF 或手動在代碼模式新增。</p>';
        return;
    }

    data.forEach((q, index) => {
        const card = document.createElement('div');
        card.className = 'q-card';
        card.dataset.index = index;

        // 生成選項 HTML
        let optionsHtml = '';
        q.options.forEach((opt, optIdx) => {
            optionsHtml += `
                <div>
                    <label class="form-label">選項 ${String.fromCharCode(65 + optIdx)}</label>
                    <input type="text" class="form-input inp-option" data-opt-idx="${optIdx}" value="${opt}">
                </div>
            `;
        });

        // 答案選擇的下拉選單
        let answerSelect = `<select class="form-input inp-answer">`;
        q.options.forEach((_, idx) => {
            answerSelect += `<option value="${idx}" ${q.answer === idx ? 'selected' : ''}>選項 ${String.fromCharCode(65 + idx)}</option>`;
        });
        answerSelect += `</select>`;

        card.innerHTML = `
            <div class="form-group">
                <label class="form-label"><strong>第 ${index + 1} 題題目</strong></label>
                <textarea class="form-input inp-question" rows="2">${q.question}</textarea>
            </div>
            
            <div class="form-group options-grid">
                ${optionsHtml}
            </div>

            <div class="meta-row">
                <div style="flex: 1;">
                    <label class="form-label">正確答案</label>
                    ${answerSelect}
                </div>
                <div style="flex: 1;">
                    <label class="form-label">圖片 ID (選填)</label>
                    <input type="text" class="form-input inp-img" value="${q.img || ''}" placeholder="例如: img_1">
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// 4. 將圖形介面數據同步回 JSON (Sync Logic)
function syncVisualToJSON() {
    const cards = document.querySelectorAll('.q-card');
    const newData = [];

    cards.forEach(card => {
        const question = card.querySelector('.inp-question').value;
        const options = Array.from(card.querySelectorAll('.inp-option')).map(inp => inp.value);
        const answer = parseInt(card.querySelector('.inp-answer').value);
        const img = card.querySelector('.inp-img').value.trim() || null;
        
        newData.push({
            id: parseInt(card.dataset.index) + 1,
            question,
            options,
            answer,
            img
        });
    });

    // 更新 Textarea
    document.getElementById('json-textarea').value = JSON.stringify(newData, null, 4);
}

// 5. JSON 格式化工具 (User Requested)
function formatJSON() {
    const textarea = document.getElementById('json-textarea');
    try {
        const currentVal = textarea.value;
        const parsed = JSON.parse(currentVal);
        // 重新格式化，縮排 4 空格
        textarea.value = JSON.stringify(parsed, null, 4);
        alert("格式已修正！JSON 語法正確。");
    } catch (e) {
        alert("格式錯誤！無法美化。\n原因: " + e.message);
    }
}

// --- 以下為圖片處理與輔助函式 (保持原樣優化版) ---

function convertImageToBase64(imgObj) {
    return new Promise((resolve) => {
        const MAX_WIDTH = 600;
        let width = imgObj.width;
        let height = imgObj.height;
        if (width > MAX_WIDTH) {
            const scale = MAX_WIDTH / width;
            width = MAX_WIDTH;
            height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        
        if (imgObj.bitmap) {
            ctx.drawImage(imgObj.bitmap, 0, 0, width, height);
        } else {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imgObj.width;
            tempCanvas.height = imgObj.height;
            const tCtx = tempCanvas.getContext('2d');
            const data = new ImageData(new Uint8ClampedArray(imgObj.data), imgObj.width, imgObj.height);
            tCtx.putImageData(data, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0, width, height);
        }
        resolve(canvas.toDataURL('image/jpeg', 0.8));
    });
}

function renderImageGallery() {
    const gallery = document.getElementById('image-gallery');
    gallery.innerHTML = '';
    
    if (Object.keys(extractedImages).length === 0) {
        gallery.innerHTML = '<p style="color:#999;font-size:12px;">無圖片</p>';
        return;
    }

    for (const [id, src] of Object.entries(extractedImages)) {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.id = `gallery-${id}`;
        div.innerHTML = `
            <div class="img-wrapper">
                <img src="${src}" onclick="previewImage('${src}')">
            </div>
            <div class="img-controls">
                <span class="badge" style="background:#eee;color:#333">${id}</span>
                <div>
                    <button class="btn-icon btn-copy" onclick="copyId('${id}')">複製</button>
                    <button class="btn-icon btn-del" onclick="deleteImage('${id}')">刪</button>
                </div>
            </div>
        `;
        gallery.appendChild(div);
    }
}

window.copyId = function(id) {
    navigator.clipboard.writeText(id).then(() => {
        // 如果在圖形模式，嘗試自動填入當前焦點的輸入框 (UX Bonus)
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('inp-img')) {
            activeEl.value = id;
            // 觸發 input 事件以確保狀態更新 (若有監聽)
        } else {
            alert(`已複製 ${id}，請貼到對應題目的圖片欄位`);
        }
    });
};

window.deleteImage = function(id) {
    delete extractedImages[id];
    const el = document.getElementById(`gallery-${id}`);
    if (el) el.remove();
};

window.previewImage = function(src) {
    const w = window.open("");
    w.document.write(`<img src="${src}" style="max-width:100%">`);
};

function parseTextToQuiz(text) {
    const questions = [];
    const rawQuestions = text.split(/\d+\.\s+/).slice(1); 
    rawQuestions.forEach((raw, index) => {
        let parts = raw.split(/[A-D]\.|[（(][A-D][）)]/);
        if (parts.length >= 2) {
            questions.push({
                id: index + 1,
                question: parts[0].trim(),
                options: [
                    parts[1] ? parts[1].trim() : "選項 A",
                    parts[2] ? parts[2].trim() : "選項 B",
                    parts[3] ? parts[3].trim() : "選項 C",
                    parts[4] ? parts[4].trim() : "選項 D"
                ],
                answer: 0,
                img: null
            });
        }
    });
    return questions;
}

// 6. 生成測驗頁面 (整合圖檔)
function openQuizPage() {
    // 確保最後的編輯被保存
    if (currentMode === 'visual') {
        syncVisualToJSON();
    }

    const jsonContent = document.getElementById('json-textarea').value;
    let quizDataRaw;

    try {
        quizDataRaw = JSON.parse(jsonContent);
    } catch (e) {
        alert("JSON 格式有誤，請切換到代碼模式檢查！");
        return;
    }

    // 整合圖片數據
    const finalQuizData = quizDataRaw.map(q => ({
        ...q,
        img: (q.img && extractedImages[q.img]) ? extractedImages[q.img] : null
    }));

    try {
        sessionStorage.setItem('currentQuizData', JSON.stringify(finalQuizData));
        window.open('quiz.html', '_blank');
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            alert("圖片過多導致容量不足，請刪除不必要的圖片。");
        } else {
            alert("錯誤：" + e.message);
        }
    }
}

function downloadJSON() {
    // 1. 如果在圖形模式，先同步數據
    if (currentMode === 'visual') syncVisualToJSON();
    
    // 2. 取得當前的題目結構
    const jsonContent = document.getElementById('json-textarea').value;
    let data;
    try {
        data = JSON.parse(jsonContent);
    } catch (e) {
        alert("JSON 格式錯誤，無法下載！");
        return;
    }

    // 3. 關鍵步驟：將 ID 替換為真實的 Base64 圖片數據
    const exportData = data.map(q => {
        // 如果題目有設定 img，且該 img ID 存在於我們的圖庫中
        if (q.img && extractedImages[q.img]) {
            return {
                ...q,
                img: extractedImages[q.img] // 這裡把 "img_1" 換成了 "data:image/jpeg;base64..."
            };
        }
        return q; // 沒圖就保持原樣
    });

    // 4. 觸發下載
    const blob = new Blob([JSON.stringify(exportData, null, 4)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "quiz_data_with_images.json"; // 改個檔名示意
    link.click();
}

// ==========================================
// [新增] 智能排版優化功能
// ==========================================
function cleanWhitespace() {
    // 1. 如果在圖形模式，先確保數據同步到 Textarea
    if (currentMode === 'visual') {
        syncVisualToJSON();
    }

    const textarea = document.getElementById('json-textarea');
    let data;

    try {
        data = JSON.parse(textarea.value);
    } catch (e) {
        alert("JSON 格式有誤，無法執行清理！請先修正語法錯誤。");
        return;
    }

    // 2. 遍歷所有資料進行清理
    const cleanedData = data.map(q => {
        return {
            ...q,
            question: smartTrim(q.question),
            options: q.options.map(opt => smartTrim(opt))
        };
    });

    // 3. 更新數據回介面
    const jsonStr = JSON.stringify(cleanedData, null, 4);
    textarea.value = jsonStr;

    // 如果當前是圖形模式，要立刻刷新畫面讓用戶看到結果
    if (currentMode === 'visual') {
        renderVisualEditor(cleanedData);
    }

    // 稍微提示一下用戶
    // 為了不打擾操作，這裡用 console.log 或簡單的 alert，或者你可以做個 toast
    // alert("排版優化完成！已清除多餘空格。"); 
    // 為了體驗更順暢，建議顯示一個短暫的狀態文字就好：
    showStatusMsg("✅ 排版已優化：清除多餘空格");
}

// 核心字串處理函式 (Regex 黑魔法)
function smartTrim(str) {
    if (!str) return "";

    return str
        // 1. 將所有連續空格(包含換行 tab) 縮減為一個空格
        .replace(/\s+/g, ' ')
        
        // 2. 刪除 [中文字] 與 [中文字] 之間的空格
        // 例如: "連結 小 區 域" -> "連結小區域"
        .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
        
        // 3. 刪除 [中文字] 與 [全形標點] 之間的空格 (含前後)
        // 例如: "設備 ？" -> "設備？"
        .replace(/\s+([，。、？！：；「」『』（）])/g, '$1')
        .replace(/([，。、？！：；「」『』（）])\s+/g, '$1')
        
        // 4. 修復括號內的多餘空格 (針對你的例子: ( 1 公里 ) -> (1 公里))
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        
        // 5. 去除頭尾空白
        .trim();
}

// 簡單的狀態提示小幫手 (放在 action-footer 裡)
function showStatusMsg(msg) {
    const el = document.getElementById('status-msg');
    if (el) {
        el.innerText = msg;
        el.style.color = "green";
        setTimeout(() => { el.innerText = ""; }, 2000);
    }
}