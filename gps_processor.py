from dotenv import load_dotenv
load_dotenv()
import mysql.connector
import os

mydb = mysql.connector.connect(
  host=os.getenv("HOST"),
  user=os.getenv("DB_USER"),
  password=os.getenv("DB_PASS"),
  database=os.getenv("DB_NAME")
)

dataFile = open('data.txt', 'r')
logs = dataFile.readlines()

mycursor = mydb.cursor()
sql = "INSERT INTO gpsUpdates (timestamp, lat, lng, alt) VALUES (%s, %s, %s, %s)"
val = []

for log in logs:
	if "GPS" in log:
		log = log.split('GPS|')
		timeData = log[0]
		gpsData = log[1]

		timeData = timeData.split(' ')[1]
		time = "2020-09-05 " + str(int(timeData[0:2]) - 6) + ":" + timeData[2:4] + ":" + timeData[4:6]

		gpsData = gpsData.strip()
		gpsData = gpsData.split(',')

		val.append( (time, gpsData[0], gpsData[1], gpsData[2]) )

print(val)

mycursor.executemany(sql, val)

mydb.commit()
