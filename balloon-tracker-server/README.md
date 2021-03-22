# Balloon Tracker Server

### Purpose
The balloon tracker server is responsible for coordinating GPS updates received from multiple balloon-tracker-clients, maintaining a centeral database of GPS position updates, and pushing updates out to other balloon-tracker-clients. The balloon tracker server also generates flight path predictions at 5 minute intervals and sends them to balloon-tracker-clients for display.

### Installation
Download the required dependencies with `npm install`

Run the balloon-tracker-client with `node server.js`