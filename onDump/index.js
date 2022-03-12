const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const ses = new AWS.SES();
const documentClient = new AWS.DynamoDB.DocumentClient();

const blockify = (newBlocks, transcriptObject, numSpeakers) => {
  const items = transcriptObject.results.items;

  if(numSpeakers > 1) {
    // Split transcript into blocks
    let blocks = [];

    let i = 0;
    const segments = transcriptObject.results.speaker_labels.segments;
    segments.forEach((seg) => {
      let speakerId = parseInt(seg.speaker_label.split('_')[1]);
      let speakerName = "Speaker " + speakerId;
      let startTime = seg.start_time;
      let endTime = seg.end_time;
      let text = "";

      const segmentItems = seg.items;
      segmentItems.forEach((word, index) => {
        let item = items[i];
        text += item.alternatives[0].content;
        if(items[i + 1] && (item.type == "pronunciation" && items[i + 1].type == "punctuation")) {
          text += items[i + 1].alternatives[0].content + " ";
          i++;
        } else {
          text += " ";
        }
        i++;
      });
      text = text.substring(0, text.length - 1);
      blocks.push({speakerId, speakerName, startTime, endTime, text});
    });

    let ind = 0;
    while(ind < blocks.length) {
      let currBlock = blocks[ind];
      let newText = "";
      while(blocks[ind] && blocks[ind].speakerId == currBlock.speakerId) {
        newText += blocks[ind].text + " ";
        ind++;
      }
      newText = newText.substring(0, newText.length - 1);
      newBlocks.push({...currBlock, startTime: currBlock.startTime, endTime: blocks[ind - 1].endTime, text: newText});
    }
  } else {
    newBlocks.push({
      speakerId: 0,
      speakerName: "Speaker 0",
      startTime: items[0].start_time,
      endTime: items[items.length - 2].end_time,
      text: transcriptObject.results.transcripts[0].transcript
    });
  }
  console.log(newBlocks);
};

exports.handler = async (event) => {
    
    // Triggered by S3 event
    const bucketName = event.Records[0].s3.bucket.name;
    const itemKey = event.Records[0].s3.object.key;
    
    // Item Key: guest-${transcriptId}.json
    const transcriptId = itemKey.substring(6, itemKey.lastIndexOf('.'));
    
    try {
      // Get transcript text from S3
      const s3Params = {
        Bucket: bucketName,
        Key: itemKey
      }
      
      const transcriptFile = await s3.getObject(s3Params).promise();
      const transcriptObject = JSON.parse(transcriptFile.Body.toString());
      
      // Get email from database
      const dynamoParams = {
          TableName: 'wordbose-guests',
          Key: {
            transcriptId: transcriptId,
          }
      };
      
      const obj = await documentClient.get(dynamoParams).promise();
      const item = obj.Item;
      const guestEmail = item.email;
      const numSpeakers = item.numSpeakers;
      console.log(item);
      
      // Format transcript
      let newBlocks = [];
      blockify(newBlocks, transcriptObject, numSpeakers);
      
      // Send to email from database
      let formattedTranscript = "";
      let rawTranscript = "";
      
      newBlocks.forEach((block) => {
        formattedTranscript += `<h4>${block.speakerName}</h4><p>${block.text}</p><br/>`;
        rawTranscript += `${block.speakerName}: ${block.text}\n`;
      });
      
      rawTranscript = rawTranscript.substring(0, rawTranscript.length - 1);
      
      console.log(formattedTranscript);
      
      const emailParams = {
          Destination: {
            ToAddresses: [item.email]
          },
          Message: {
          Body: {
            Html: {
              Charset: "UTF-8",
              Data: `
                  <div>
                    <div style="padding: 16px 0;">
                      <h1>Wordbose | AI-Powered Audio Transcription</h1>
                    </div>
                    <div>
                      <h2>Here's your transcript!</h2>
                      ${formattedTranscript}
                    </div>
                  </div>
              `
            },
            Text: {
              Charset: "UTF-8",
              Data: rawTranscript
            }
          },
          Subject: {
            Charset: "UTF-8",
            Data: "Your transcript is complete!"
          }
        },
          Source: "Wordbose Notifications <notifications@wordbose.com>"
      };
      
      console.log("Sending email to", guestEmail);
      const sentEmail = await ses.sendEmail(emailParams).promise();
        
    } catch (err) {
        console.log(err);
        const response = {
            statusCode: 500,
            body: JSON.stringify({status: false}),
        };
        return response;
    }
    
    console.log("Email successfully sent");
    
    const response = {
        statusCode: 200,
        body: JSON.stringify('Success'),
    };
    return response;
};
