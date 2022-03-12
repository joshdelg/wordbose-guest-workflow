const AWS = require('aws-sdk');
const transcribe = new AWS.TranscribeService();
const documentClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
    
    const destBucketName = 'wordbose-test-guest-destination';

    // Triggered by S3 event
    const bucketName = event.Records[0].s3.bucket.name;
    const itemKey = event.Records[0].s3.object.key;
    
    // Item Key in form guest-${transcriptId}.ext 
    const transcriptId = itemKey.substring(6, itemKey.lastIndexOf('.'));
    const jobName = itemKey.substring(0, itemKey.lastIndexOf('.'));

    const s3URI = `s3://${bucketName}/${itemKey}`;
    
    try {
        // Get numSpeakers from DynamoDB
        const dynamoParams = {
          TableName: 'wordbose-guests',
          Key: {
            transcriptId: transcriptId,
          }
        };
      
        const obj = await documentClient.get(dynamoParams).promise();
        const item = obj.Item;
        const numSpeakers = item.numSpeakers;
        
        // Send to transcript
        const transcribeParams = {
            LanguageCode: 'en-US',
            Media: {
                MediaFileUri: s3URI
            },
            TranscriptionJobName: jobName,
            OutputBucketName: destBucketName,
            Settings: (numSpeakers > 1) ? ({
                MaxSpeakerLabels: numSpeakers,
                ShowSpeakerLabels: true
            }) : {}
        };
        
        await transcribe.startTranscriptionJob(transcribeParams).promise();
        
        const response = {
            statusCode: 200,
            body: JSON.stringify('Success!'),
        };
        return response;
    } catch (err) {
        console.log(err, err.stack);
        const response = {
            statusCode: 500,
            body: JSON.stringify({status: false}),
        };
        return response;
    }
};
