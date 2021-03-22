from dotenv import load_dotenv
load_dotenv()
import mysql.connector
from GPSPhoto import gpsphoto
import os

imageDir = '/mnt/c/Users/blaze/Desktop/pics';
images = os.listdir(imageDir)

mydb = mysql.connector.connect(
  host=os.getenv("HOST"),
  user=os.getenv("DB_USER"),
  password=os.getenv("DB_PASS"),
  database=os.getenv("DB_NAME")
)

mycursor = mydb.cursor()


for image in images:
	if ".JPG" in image:
		imageNameTime = image.split('.')[0]
		dbTime = "2020-09-05 " + str(int(imageNameTime[0:2]) - 6) + ":" + imageNameTime[2:4] + ":" + imageNameTime[4:6]
		utcTime = "2020-09-05 " + str(int(imageNameTime[0:2]) - 0) + ":" + imageNameTime[2:4] + ":" + imageNameTime[4:6]

		# Get assoc GPS coords
		mycursor.execute("SELECT lat,lng,alt FROM gpsUpdates ORDER BY abs(TIMESTAMPDIFF(second, timestamp, '" + dbTime + "')) LIMIT 1")

		myresult = mycursor.fetchone()

		# print(image,myresult)

		photo = gpsphoto.GPSPhoto(imageDir + "/" + image)

		# Create GPSInfo Data Object
		info = gpsphoto.GPSInfo((float(myresult[0]), float(myresult[1])), alt=int(myresult[2]), timeStamp=utcTime.replace('-', ':'))

		# Modify GPS Data
		photo.modGPSData(info, '/mnt/c/Users/blaze/Desktop/procPics/' + image)

		print(image)










