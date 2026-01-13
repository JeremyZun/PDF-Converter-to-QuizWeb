let quizData = [];
let timerInterval;
let secondsElapsed = 0;

window.onload = function() {
    loadQuizData();
};

function loadQuizData() {
    const storedData = sessionStorage.getItem('currentQuizData');
    if (!storedData) {
        document.getElementById('quiz-container').innerHTML = 
            '<p style="color:red; text-align:center;">錯誤：找不到題庫數據。<br>請回到首頁重新上傳並生成。</p>';
        return;
    }
    try {
        let rawData = JSON.parse(storedData);
        
        // 詢問是否要隨機打亂題目 (預設執行)
        quizData = shuffleArray(rawData);

        renderQuiz();
        startTimer(); 
    } catch (e) {
        alert("資料損毀");
    }
}

// Fisher-Yates 洗牌演算法
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function startTimer() {
    const timerEl = document.getElementById('timer');
    timerInterval = setInterval(() => {
        secondsElapsed++;
        const mins = Math.floor(secondsElapsed / 60);
        const secs = secondsElapsed % 60;
        timerEl.innerText = `⏱️ ${pad(mins)}:${pad(secs)}`;
    }, 1000);
}

function pad(val) { return val > 9 ? val : "0" + val; }

function renderQuiz() {
    const quizContainer = document.getElementById('quiz-container');
    quizContainer.innerHTML = '';

    quizData.forEach((q, index) => {
        const qBlock = document.createElement('div');
        qBlock.className = 'question-block';
        
        let imageHtml = q.img ? `<div class="q-image"><img src="${q.img}"></div>` : '';

        // [重要] 建立帶有原始索引的物件陣列，這樣打亂後還能知道哪個是正確答案
        let optionsWithIndex = q.options.map((opt, i) => ({ text: opt, originalIndex: i }));
        
        // 打亂選項順序
        optionsWithIndex = shuffleArray(optionsWithIndex);
        
        let optionsHtml = '';
        optionsWithIndex.forEach((optObj, displayIndex) => {
            optionsHtml += `
                <label class="option-label">
                    <input type="radio" name="q-${index}" value="${optObj.originalIndex}">
                    <span class="opt-text">${optObj.text}</span>
                </label>
            `;
        });

        qBlock.innerHTML = `
            <div class="question-title">
                <span class="badge">${index + 1}</span> ${q.question}
            </div>
            ${imageHtml}
            <div class="options-group">${optionsHtml}</div>
        `;
        quizContainer.appendChild(qBlock);
    });

    document.getElementById('controls').classList.remove('hidden');
}

function checkAnswers() {
    clearInterval(timerInterval); 

    let score = 0;
    const mins = Math.floor(secondsElapsed / 60);
    const secs = secondsElapsed % 60;
    const timeStr = `${mins}分${secs}秒`;
    const resultArea = document.getElementById('result-area');
    
    // [修正] 先清空，再生成完整字串，避免計時被覆蓋
    resultArea.innerHTML = '';

    quizData.forEach((q, index) => {
        const selected = document.querySelector(`input[name="q-${index}"]:checked`);
        const qBlock = document.querySelectorAll('.question-block')[index];
        
        qBlock.classList.remove('correct-block', 'wrong-block');
        
        // 重置選項樣式
        qBlock.querySelectorAll('.opt-text').forEach(el => {
            el.style.color = 'inherit';
            el.style.fontWeight = 'normal';
        });

        if (selected) {
            const val = parseInt(selected.value);
            if (val === q.answer) {
                score++;
                qBlock.classList.add('correct-block');
            } else {
                qBlock.classList.add('wrong-block');
                
                // [修正邏輯] 因為選項被洗牌，不能用索引找 label
                // 我們要找 value 等於正確答案的那個 input，再往上找 label
                const correctInput = qBlock.querySelector(`input[value="${q.answer}"]`);
                if (correctInput) {
                    const correctLabel = correctInput.closest('.option-label');
                    const textSpan = correctLabel.querySelector('.opt-text');
                    textSpan.style.color = "green";
                    textSpan.style.fontWeight = "bold";
                }
            }
        } else {
             // 沒作答的也要標示正確答案
             const correctInput = qBlock.querySelector(`input[value="${q.answer}"]`);
             if (correctInput) {
                 const correctLabel = correctInput.closest('.option-label');
                 const textSpan = correctLabel.querySelector('.opt-text');
                 textSpan.style.color = "green";
                 textSpan.style.fontWeight = "bold";
             }
        }
    });

    // 顯示最終結果與時間
    resultArea.innerHTML = `
        <div style="font-size: 24px; margin-top: 20px; padding: 20px; background: #fff; border-radius: 8px;">
            <p style="margin:0 0 10px 0; font-size: 16px; color:#666;">作答時間：${timeStr}</p>
            最終得分：<strong style="color: var(--primary); font-size: 1.5em;">${score}</strong> / ${quizData.length}
        </div>
    `;
    
    resultArea.scrollIntoView({ behavior: 'smooth' });
}