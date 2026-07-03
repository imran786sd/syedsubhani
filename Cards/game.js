// === SUPABASE SETUP ===
const SUPABASE_URL = "https://pjyqmjvzgawzwpshtcrn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_SmrBRls3lREh3UaZyZfuBQ_SwigfJ7B";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let myId = Math.random().toString(36).substring(2, 9);
let myName = "";
let playersArray = [];
let gameState = null;
let pendingWildAction = null; 

const channel = supabaseClient.channel('uno-room', {
    config: { broadcast: { self: true } }
});

channel.on('broadcast', { event: 'lobby' }, (payload) => {
    handleLobbyUpdate(payload.payload.players);
}).on('broadcast', { event: 'game' }, (payload) => {
    handleGameStateUpdate(payload.payload.state, payload.payload.players);
}).on('broadcast', { event: 'log' }, (payload) => {
    appendLogToPanel(payload.payload.message, payload.payload.type);
}).subscribe();

// === LOG & CHAT LOGIC ===
function toggleLog() { document.getElementById('side-panel').classList.toggle('open'); }

function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if(!msg) return;
    const chatString = `<strong>${myName}:</strong> ${msg}`;
    channel.send({ type: 'broadcast', event: 'log', payload: { message: chatString, type: 'chat' } });
    input.value = '';
}

function broadcastActionLog(msg) {
    channel.send({ type: 'broadcast', event: 'log', payload: { message: msg, type: 'action' } });
}

function appendLogToPanel(message, type) {
    const logBox = document.getElementById('log-content');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = message;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

// === GAME & LOBBY LOGIC ===
function joinGame() {
    const nameInput = document.getElementById('username').value.trim();
    if(!nameInput) return alert("Please enter a name.");
    
    // UNIQUE NAME CHECK
    const nameExists = playersArray.some(p => p.name.toLowerCase() === nameInput.toLowerCase());
    if (nameExists) {
        return alert("That name is already taken! Please choose another one.");
    }

    myName = nameInput;
    document.getElementById('username').disabled = true;

    playersArray.push({ id: myId, name: myName, hand: [] });
    channel.send({ type: 'broadcast', event: 'lobby', payload: { players: playersArray } });
}

function handleLobbyUpdate(incomingPlayers) {
    let newPlayerAdded = false;
    let newPlayersList = [];

    incomingPlayers.forEach(p => {
        if (!playersArray.some(existing => existing.id === p.id)) {
            playersArray.push(p);
            newPlayerAdded = true;
            newPlayersList.push(p);
        }
    });

    if (!gameState || !gameState.gameStarted) {
        document.getElementById('waiting-list').innerHTML = playersArray.map(p => `<li>👤 ${p.name}</li>`).join('');
        if (playersArray.length >= 2) document.getElementById('start-btn').classList.remove('hidden');
    } else if (newPlayerAdded && gameState.gameStarted) {
        if (playersArray[gameState.turnIndex].id === myId) {
            newPlayersList.forEach(newP => {
                for(let i=0; i<7; i++) {
                    if(gameState.deck.length > 0) newP.hand.push(gameState.deck.pop());
                }
                broadcastActionLog(`👋 ${newP.name} joined the table mid-game!`);
            });
            channel.send({ type: 'broadcast', event: 'game', payload: { state: gameState, players: playersArray } });
        }
    }
}

function startGame() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Ø', '⇄', '+2'];
    let deck = [];
    
    const decksNeeded = Math.ceil(playersArray.length / 4) + 1; 
    for (let d = 0; d < decksNeeded; d++) {
        for (let color of colors) {
            for (let value of values) {
                deck.push({ color, value });
                if (value !== '0') deck.push({ color, value });
            }
        }
        for(let i=0; i<4; i++) {
            deck.push({ color: 'black', value: 'W' });
            deck.push({ color: 'black', value: '+4' });
        }
    }
    deck.sort(() => Math.random() - 0.5);

    playersArray.forEach(p => {
        p.hand = [];
        for(let i=0; i<7; i++) p.hand.push(deck.pop());
    });

    let topCard = deck.pop();
    while(topCard.color === 'black') {
        deck.unshift(topCard);
        topCard = deck.pop();
    }

    gameState = { gameStarted: true, turnIndex: 0, direction: 1, topCard: topCard, deck: deck, winner: "" };
    
    broadcastActionLog(`🎲 The game has started!`);
    channel.send({ type: 'broadcast', event: 'game', payload: { state: gameState, players: playersArray } });
}

function handleGameStateUpdate(state, players) {
    gameState = state; playersArray = players;
    if (gameState.winner) {
        alert(`🎉 ${gameState.winner} wins!`);
        location.reload(); return;
    }
    
    if (!playersArray.some(p => p.id === myId) && gameState.gameStarted) {
        alert("You have been removed from the table.");
        location.reload(); return;
    }

    if (gameState.gameStarted) {
        document.getElementById('join-screen').classList.add('hidden');
        document.getElementById('game-view').classList.remove('hidden');
        renderGame();
    }
}

// === REMOVE INACTIVE PLAYER LOGIC ===
function kickPlayer(kickedId) {
    const index = playersArray.findIndex(p => p.id === kickedId);
    if (index === -1) return;
    
    const kickedPlayer = playersArray[index];
    gameState.deck.unshift(...kickedPlayer.hand); 
    playersArray.splice(index, 1);
    
    if (gameState.turnIndex > index) {
        gameState.turnIndex--; 
    } else if (gameState.turnIndex === index) {
        gameState.turnIndex = gameState.turnIndex % playersArray.length;
    }

    broadcastActionLog(`👢 ${kickedPlayer.name} was removed from the table.`);
    channel.send({ type: 'broadcast', event: 'game', payload: { state: gameState, players: playersArray } });
}

// === RENDER UI ===
function renderGame() {
    const activePlayer = playersArray[gameState.turnIndex];
    const isMyTurn = (activePlayer.id === myId);

    document.getElementById('turn-status').innerText = isMyTurn ? "🟢 YOUR TURN!" : `⚪ ${activePlayer.name}'s turn...`;
    document.getElementById('direction-indicator').innerText = gameState.direction === 1 ? "🔄 Direction: Normal ➔" : "🔄 Direction: Reversed ⬅";

    const topCardDiv = document.getElementById('top-card');
    topCardDiv.className = `card ${gameState.topCard.color}`;
    document.getElementById('top-card-text').innerText = gameState.topCard.value;

    document.getElementById('my-name').innerText = myName;
    if (isMyTurn) document.getElementById('my-player-area').classList.add('active-turn');
    else document.getElementById('my-player-area').classList.remove('active-turn');

    const handDiv = document.getElementById('hand');
    handDiv.innerHTML = '';
    const myData = playersArray.find(p => p.id === myId);
    const myHand = myData ? myData.hand : [];

    myHand.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${card.color}`;
        cardDiv.innerHTML = `<span class="card-text">${card.value}</span>`;

        if (isMyTurn && (card.color === gameState.topCard.color || card.value === gameState.topCard.value || card.color === 'black')) {
            cardDiv.classList.add('playable');
            cardDiv.onclick = () => handleCardClick(index, card, myHand);
        }
        handDiv.appendChild(cardDiv);
    });

    renderOpponentsRadial();
}

function renderOpponentsRadial() {
    const oppContainer = document.getElementById('opponents-container');
    oppContainer.innerHTML = '';
    
    const myIndex = playersArray.findIndex(p => p.id === myId);
    let opponents = [];
    for (let i = 1; i < playersArray.length; i++) {
        opponents.push(playersArray[(myIndex + i) % playersArray.length]);
    }

    const totalOpp = opponents.length;
    opponents.forEach((opp, i) => {
        const fraction = (i + 1) / (totalOpp + 1); 
        const angle = Math.PI + (fraction * Math.PI); 
        
        const radiusX = 40; 
        const radiusY = 35; 
        
        const leftPercent = 50 + (Math.cos(angle) * radiusX);
        const topPercent = 50 + (Math.sin(angle) * radiusY);

        const isActive = playersArray[gameState.turnIndex].id === opp.id;

        const seatDiv = document.createElement('div');
        seatDiv.className = `opponent-seat ${isActive ? 'active-turn' : ''}`;
        seatDiv.style.left = `${leftPercent}%`;
        seatDiv.style.top = `${topPercent}%`;

        seatDiv.innerHTML = `
            <div class="opp-avatar">
                <button class="kick-btn" onclick="kickPlayer('${opp.id}')">✖</button>
                ${opp.name}
            </div>
            <div class="opp-cards">${opp.hand.length}</div>
        `;
        oppContainer.appendChild(seatDiv);
    });
}

// === CARD ACTIONS ===
function handleCardClick(index, card, hand) {
    if (card.color === 'black') {
        pendingWildAction = { index, card, hand };
        document.getElementById('color-picker-modal').classList.remove('hidden');
    } else {
        executePlayCard(index, card, hand);
    }
}

function submitWildColor(color) {
    document.getElementById('color-picker-modal').classList.add('hidden');
    if (pendingWildAction) {
        pendingWildAction.card.color = color;
        broadcastActionLog(`🎨 ${myName} changed the color to ${color.toUpperCase()}!`);
        executePlayCard(pendingWildAction.index, pendingWildAction.card, pendingWildAction.hand);
        pendingWildAction = null;
    }
}

function executePlayCard(index, card, hand) {
    hand.splice(index, 1);
    const myData = playersArray.find(p => p.id === myId);
    myData.hand = hand;

    if (card.color !== 'black') {
        broadcastActionLog(`🃏 ${myName} played a ${card.color} ${card.value}`);
    }

    if (hand.length === 0) {
        gameState.winner = myName;
    } else {
        let steps = 1;
        if (card.value === '⇄') {
            gameState.direction *= -1;
            if (playersArray.length === 2) steps = 2;
        } else if (card.value === 'Ø') {
            steps = 2;
        } else if (card.value === '+2') {
            let nextIdx = (gameState.turnIndex + gameState.direction + playersArray.length) % playersArray.length;
            playersArray[nextIdx].hand.push(gameState.deck.pop(), gameState.deck.pop());
            steps = 2;
        } else if (card.value === '+4') {
            let nextIdx = (gameState.turnIndex + gameState.direction + playersArray.length) % playersArray.length;
            playersArray[nextIdx].hand.push(gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop());
            steps = 2;
        }

        gameState.turnIndex = (gameState.turnIndex + (steps * gameState.direction) + (playersArray.length * 10)) % playersArray.length;
        gameState.topCard = card;
        
        document.getElementById('top-card').style.transform = `rotate(${(Math.random() * 30) - 15}deg)`;
    }

    channel.send({ type: 'broadcast', event: 'game', payload: { state: gameState, players: playersArray } });
}

function drawCard() {
    const activePlayer = playersArray[gameState.turnIndex];
    if (activePlayer.id !== myId) return;

    const newCard = gameState.deck.pop();
    const myData = playersArray.find(p => p.id === myId);
    myData.hand.push(newCard);

    broadcastActionLog(`📥 ${myName} drew a card.`);

    gameState.turnIndex = (gameState.turnIndex + gameState.direction + playersArray.length) % playersArray.length;
    channel.send({ type: 'broadcast', event: 'game', payload: { state: gameState, players: playersArray } });
}
