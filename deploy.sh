#!/bin/sh
zip ~/Downloads/dropboxs3sync.zip -r . 
aws s3 cp ~/Downloads/dropboxs3sync.zip s3://com.sampullara.data/dropboxs3sync.zip
aws lambda update-function-code --function-name dropbox_to_s3_webhook --s3-bucket com.sampullara.data --s3-key dropboxs3sync.zip --publish
aws lambda update-function-code --function-name dropbox_to_s3_copy --s3-bucket com.sampullara.data --s3-key dropboxs3sync.zip --publish
rm ~/Dropbox/franklinlionsclub/*.deploy
echo foo > ~/Dropbox/franklinlionsclub/`date`.deploy
