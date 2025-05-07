const socket = io('http://3.80.195.216:3000');  // Replace with your EC2 IP or domain

socket.on('connect', () => {
  document.getElementById('message').textContent = 'Connected to the game server!';
});

socket.on('question', (question) => {
  document.getElementById('question').textContent = question;
});