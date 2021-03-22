# Balloon Tracker Client

### Purpose
The balloon tracker client is responsible to receiving GPS position updates through the Arduino receiver Serial port. It runs on a laptop with Node.js. It connects to the [balloon-tracker-server](../balloon-tracker-server) and must be configured with the balloon tracker server URL and port in the `.env` file. 

### Finding your COM port
Since the balloon tracker client reads GPS updates from a ground Arduino, you must pass the COM port of the Arduino as a command line parameter to the balloon-tracker-client. On windows, you can find the COM port of the USB interface by plugging in the Arduino to your PC and opening Device Manager. The Arduino will be listed with a COM port number assigned.

### Installation
Download the required dependencies with `npm install`

Run the balloon-tracker-client with `node app.js COM3` changing `COM3` to your COM port. 