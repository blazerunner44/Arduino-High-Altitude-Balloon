from dotenv import load_dotenv
load_dotenv()
import os
import mysql.connector
import math

def getDistanceBetween(point1, point2):
  R = 3958.8 # Radius of the earth in mi
  dLat = (math.pi/180) * (float(point2[0])-float(point1[0]))
  dLon = (math.pi/180) * (float(point2[1])-float(point1[1])) 
  a = math.sin(dLat/2) * math.sin(dLat/2) + math.cos((math.pi/180) * (float(point1[0]))) * math.cos((math.pi/180) * (float(point2[0]))) * math.sin(dLon/2) * math.sin(dLon/2)
    
  c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
  d = R * c #Distance in km
  return d

mydb = mysql.connector.connect(
  host=os.getenv("HOST"),
  user=os.getenv("DB_USER"),
  password=os.getenv("DB_PASS"),
  database=os.getenv("DB_NAME")
)

mycursor = mydb.cursor()

mycursor.execute("SELECT lat,lng FROM gpsUpdates")

rows = mycursor.fetchall()

totalDistance = 0

for i in range(0, len(rows) - 1):
  # print(i)
  totalDistance += getDistanceBetween(rows[i], rows[i+1])

print(totalDistance)














